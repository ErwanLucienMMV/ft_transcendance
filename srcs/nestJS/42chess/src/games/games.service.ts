import { Injectable } from '@nestjs/common';
import { User } from '../users/user.entity.js';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import { GameRulesService } from './game-rules.service.js';
import { GameStoreService } from './game-store.service.js';
import { GameError } from './game-error.js';
import { creationInput, identifier, moveInput } from './game-input.js';
import { activePlayer, automaticResult, finishGame } from './game-actions.js';
import { GameAgreementsService } from './game-agreements.service.js';
import { GameClocksService } from './clock/game-clocks.service.js';
import { algebraicMove } from './game-notation.js';
import type { CreateGameInput, DrawClaim, GameState } from './game-state.js';

/** Actor IDs must come from authenticated server context, never request bodies. */
@Injectable()
export class GamesService {
  constructor(
    private readonly store: GameStoreService,
    private readonly rules: GameRulesService,
    private readonly agreements: GameAgreementsService,
    private readonly clocks: GameClocksService,
  ) {}

  async create(actor: string, input: CreateGameInput): Promise<GameState> {
    const userId = identifier(actor);
    const { initialTime, increment, color, initialFen, opponentId } =
      creationInput(input);
    if (opponentId === userId)
      throw new GameError(
        'INVALID_GAME_INPUT',
        'A player cannot invite themselves.',
      );
    const snapshot = await this.rules.analyze({ fen: initialFen });
    if (snapshot.status !== 'ongoing') {
      throw new GameError(
        'INVALID_GAME_INPUT',
        'The initial position must allow an ongoing game.',
      );
    }
    return this.store.transaction(async (manager) => {
      if (!(await manager.existsBy(User, { id: userId }))) {
        throw new GameError('USER_NOT_FOUND', 'Player account does not exist.');
      }
      if (opponentId !== null) {
        const opponent = await manager.findOneBy(User, { id: opponentId });
        if (!opponent || !opponent.emailVerifiedAt)
          throw new GameError(
            'USER_NOT_FOUND',
            'Opponent account is not available.',
          );
      }
      const game = manager.create(Game, {
        initialTime,
        increment,
        invitedOpponentId: opponentId,
        initialFen: snapshot.fen,
        currentFen: snapshot.fen,
        turn: snapshot.turn === 'white' ? 'WHITE' : 'BLACK',
      });
      this.clocks.initialize(game);
      await manager.save(Game, game);
      await manager.save(
        GamePlayer,
        manager.create(GamePlayer, { gameId: game.id, userId, color }),
      );
      return this.store.state(manager, game);
    });
  }

  async join(actor: string, id: string): Promise<GameState> {
    const userId = identifier(actor);
    return this.store.locked(identifier(id), async (manager, state) => {
      const { game, players } = state;
      if (game.status === 'FINISHED')
        throw new GameError(
          'GAME_ALREADY_FINISHED',
          'This game has already finished.',
        );
      if (game.status !== 'WAITING')
        throw new GameError(
          'GAME_NOT_WAITING',
          'Only a waiting game can be joined.',
        );
      if (game.invitedOpponentId && game.invitedOpponentId !== userId)
        throw new GameError(
          'NOT_INVITED',
          'This game is reserved for its invited opponent.',
        );
      if (players.some((player) => player.userId === userId))
        throw new GameError(
          'ALREADY_JOINED',
          'Player already joined this game.',
        );
      if (players.length !== 1)
        throw new GameError(
          'INVALID_GAME_HISTORY',
          'A waiting game must have one creator.',
        );
      if (!(await manager.existsBy(User, { id: userId })))
        throw new GameError('USER_NOT_FOUND', 'Player account does not exist.');
      const color = players[0].color === 'WHITE' ? 'BLACK' : 'WHITE';
      await manager.save(
        GamePlayer,
        manager.create(GamePlayer, { gameId: game.id, userId, color }),
      );
      game.status = 'ACTIVE';
      game.startedAt = new Date();
      await this.clocks.start(manager, game);
      game.startedAt = new Date(game.clock!.updatedAt);
      await manager.save(Game, game);
      return this.store.state(manager, game);
    });
  }

  async get(id: string): Promise<GameState> {
    return this.store.get(identifier(id));
  }

  /** HTTP state reads also settle due clocks; terminal states remain unchanged. */
  settle(id: string): Promise<GameState> {
    return this.store.locked(identifier(id), async (manager, state) => {
      if (state.game.status === 'ACTIVE') {
        await this.clocks.settle(manager, state.game);
        await manager.save(Game, state.game);
      }
      return this.store.state(manager, state.game);
    });
  }

  async play(actor: string, id: string, input: string): Promise<GameState> {
    const userId = identifier(actor);
    const uci = moveInput(input);
    return this.store.locked(identifier(id), async (manager, state) => {
      const player = activePlayer(state, userId);
      if (await this.clocks.settle(manager, state.game)) {
        await manager.save(Game, state.game);
        return this.store.state(manager, state.game);
      }
      const before = await this.rules.current(state);
      const snapshot = await this.rules.move(state, uci);
      const { game, moves } = state;
      await manager.save(
        Move,
        manager.create(Move, {
          gameId: game.id,
          color: player.color,
          ply: moves.length + 1,
          uci,
          notation: algebraicMove(before, snapshot, uci),
          fenAfter: snapshot.fen,
        }),
      );
      await this.clocks.move(manager, game, player.color);
      game.currentFen = snapshot.fen;
      game.turn = snapshot.turn === 'white' ? 'WHITE' : 'BLACK';
      game.drawOffer = null;
      const result = automaticResult(snapshot);
      if (result !== null) {
        const reason = snapshot.checkmate
          ? 'CHECKMATE'
          : snapshot.stalemate
            ? 'STALEMATE'
            : 'INSUFFICIENT_MATERIAL';
        finishGame(game, result, reason);
        this.clocks.stop(game);
      }
      await manager.save(Game, game);
      return this.store.state(manager, game);
    });
  }

  /** A legal intended move is examined without becoming part of the stored history. */
  async claimDraw(
    actor: string,
    id: string,
    reason: DrawClaim,
    intendedMove?: string,
  ): Promise<GameState> {
    const userId = identifier(actor);
    if (!['THREEFOLD_REPETITION', 'FIFTY_MOVE'].includes(reason)) {
      throw new GameError('INVALID_GAME_INPUT', 'Unsupported draw claim.');
    }
    const uci =
      intendedMove === undefined ? undefined : moveInput(intendedMove);
    return this.store.locked(identifier(id), async (manager, state) => {
      activePlayer(state, userId);
      if (await this.clocks.settle(manager, state.game)) {
        await manager.save(Game, state.game);
        return this.store.state(manager, state.game);
      }
      const snapshot =
        uci === undefined
          ? await this.rules.current(state)
          : await this.rules.move(state, uci);
      const claimable =
        reason === 'THREEFOLD_REPETITION'
          ? snapshot.threefoldClaimable
          : snapshot.fiftyMoveClaimable;
      if (!claimable)
        throw new GameError(
          'DRAW_NOT_CLAIMABLE',
          'The rules engine does not confirm this draw claim.',
        );
      finishGame(
        state.game,
        'DRAW',
        reason === 'FIFTY_MOVE' ? 'FIFTY_MOVE_RULE' : 'THREEFOLD_REPETITION',
      );
      this.clocks.stop(state.game);
      state.game.status = 'FINISHED';
      state.game.result = 'DRAW';
      state.game.finishedAt = new Date();
      await manager.save(Game, state.game);
      return this.store.state(manager, state.game);
    });
  }

  offerDraw(actor: string, id: string): Promise<GameState> {
    return this.agreements.offer(actor, id);
  }

  acceptDraw(actor: string, id: string): Promise<GameState> {
    return this.agreements.respond(actor, id, true);
  }

  declineDraw(actor: string, id: string): Promise<GameState> {
    return this.agreements.respond(actor, id, false);
  }

  resign(actor: string, id: string): Promise<GameState> {
    return this.agreements.resign(actor, id);
  }
}
