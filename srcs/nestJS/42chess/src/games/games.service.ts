import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { PresenceService } from '../presence/presence.service.js';
import { BotTurnRunner } from '../bots/bot-turn-runner.js';
import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import type { EntityManager } from 'typeorm';
import { BotEngine, BOT_DIFFICULTIES } from '../bots/bot-engine.js';
import type { BotDifficulty } from '../bots/bot-engine.js';
import { BotPacer } from '../bots/bot-think-time.js';
import { User } from '../users/user.entity.js';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import { GameRulesService } from './game-rules.service.js';
import { GameStoreService } from './game-store.service.js';
import { GameError } from './game-error.js';
import { creationInput, identifier, moveInput } from './game-input.js';
import {
  activePlayer,
  participatingPlayer,
  automaticResult,
  finishGame,
  mandatoryDraw,
} from './game-actions.js';
import { GameAgreementsService } from './game-agreements.service.js';
import { GameClocksService } from './clock/game-clocks.service.js';
import { algebraicMove } from './game-notation.js';
import type { CreateGameInput, DrawClaim, GameState } from './game-state.js';

/** Open invitations a player may keep at once (link and friend challenges). */
export const MAX_WAITING_GAMES = 5;
/** A side that does not play its first move within this delay aborts the game. */
export const FIRST_MOVE_SECONDS = 30;

export interface WaitingGame {
  id: string;
  initialTime: number;
  increment: number;
  rated: boolean;
  invitedOpponentId: string | null;
  createdAt: Date;
}

/** Actor IDs must come from authenticated server context, never request bodies. */
@Injectable()
export class GamesService {
  constructor(
    private readonly store: GameStoreService,
    private readonly rules: GameRulesService,
    private readonly agreements: GameAgreementsService,
    private readonly clocks: GameClocksService,
    @Optional() private readonly bot?: BotEngine,
    @Optional() private readonly presence?: PresenceService,
    @Optional() private readonly pacer?: BotPacer,
  ) {}

  /** Matching supplies its transaction; queue changes and both seats commit together. */
  async createMatched(
    manager: EntityManager,
    whiteId: string,
    blackId: string,
    input: { initialTime: number; increment: number },
  ): Promise<GameState> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('Matched games require an active transaction.');
    const ids = [identifier(whiteId), identifier(blackId)].sort();
    if (ids[0] === ids[1])
      throw new GameError(
        'INVALID_GAME_INPUT',
        'Two distinct players are required.',
      );
    const { initialTime, increment } = creationInput(input);
    const users = await manager
      .createQueryBuilder(User, 'user')
      .where('user.id IN (:...ids)', { ids })
      .orderBy('user.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    if (users.length !== 2 || users.some((user) => !user.emailVerifiedAt))
      throw new GameError('USER_NOT_FOUND', 'Both players must be available.');
    if (await this.store.activeGameOf(manager, ids)) throw activeGameExists();
    const game = manager.create(Game, {
      initialTime,
      increment,
      rated: true,
      status: 'ACTIVE',
      turn: 'WHITE',
      startedAt: new Date(),
    });
    this.clocks.initialize(game);
    await this.clocks.start(manager, game);
    game.startedAt = new Date(game.clock!.updatedAt);
    await manager.save(Game, game);
    await manager.save(GamePlayer, [
      manager.create(GamePlayer, {
        gameId: game.id,
        userId: whiteId,
        color: 'WHITE',
      }),
      manager.create(GamePlayer, {
        gameId: game.id,
        userId: blackId,
        color: 'BLACK',
      }),
    ]);
    return this.store.state(manager, game);
  }

  async create(actor: string, input: CreateGameInput): Promise<GameState> {
    const userId = identifier(actor);
    const { initialTime, increment, color, initialFen, opponentId, rated } =
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
      // Serializes concurrent creates from the same account.
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.deletedAt)
        throw new GameError('USER_NOT_FOUND', 'Player account does not exist.');
      if (
        (await this.store.waitingGamesOf(manager, userId)) >= MAX_WAITING_GAMES
      )
        throw new GameError(
          'WAITING_GAME_LIMIT',
          'Cancel one of your open invitations before creating another.',
        );
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
        rated,
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
      // One game at a time, as matchmaking already requires. Both accounts are
      // locked as matchmaking locks them, so two invitations of one creator
      // opened at the same moment cannot both start.
      const ids = [userId, players[0].userId!].sort();
      const users = await manager
        .createQueryBuilder(User, 'user')
        .where('user.id IN (:...ids)', { ids })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      if (
        users.length !== 2 ||
        users.some((user) => user.deletedAt) ||
        !users.some((user) => user.id === userId)
      )
        throw new GameError('USER_NOT_FOUND', 'Player account does not exist.');
      if (await this.store.activeGameOf(manager, ids)) throw activeGameExists();
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

  /**
   * HTTP state reads also settle due clocks; terminal states remain unchanged. The
   * row is written only when a flag fell: the clock checkpoint is computed again
   * from the stored sample by the next reader.
   */
  settle(id: string): Promise<GameState> {
    return this.store.locked(identifier(id), async (manager, state) => {
      if (await this.clocks.settle(manager, state.game))
        await manager.save(Game, state.game);
      return this.store.state(manager, state.game);
    });
  }

  /**
   * Current state for the realtime refresh: a read without the game lock, clocks
   * brought up to date in memory. Only a fallen flag goes through settle().
   */
  async observe(id: string): Promise<GameState> {
    const { state, now } = await this.store.observe(identifier(id));
    return this.clocks.observe(state.game, now) ? this.settle(id) : state;
  }

  /** The open invitations this player created, newest first. */
  async waiting(actor: string): Promise<WaitingGame[]> {
    const userId = identifier(actor);
    return this.store.transaction((manager) =>
      manager.query(
        `SELECT g.id, g."initialTime", g.increment, g.rated,
                g."invitedOpponentId", g."createdAt"
         FROM games g JOIN game_players p ON p."gameId" = g.id
         WHERE p."userId" = $1 AND g.status = 'WAITING'
         ORDER BY g."createdAt" DESC, g.id`,
        [userId],
      ),
    );
  }

  /** The creator withdraws an invitation nobody accepted yet. */
  async cancel(actor: string, id: string): Promise<void> {
    const userId = identifier(actor);
    await this.store.locked(identifier(id), async (manager, state) => {
      if (!state.players.some((player) => player.userId === userId))
        throw new GameError(
          'NOT_A_PLAYER',
          'Only the player who created this game can cancel it.',
        );
      if (state.game.status !== 'WAITING')
        throw new GameError(
          'GAME_NOT_WAITING',
          'Only a game nobody joined yet can be cancelled.',
        );
      await manager.query(`DELETE FROM game_messages WHERE "gameId" = $1`, [
        state.game.id,
      ]);
      await manager.delete(Game, { id: state.game.id });
    });
  }

  /**
   * Before both sides moved, either player may abort: the game ends without a
   * result and no rating changes.
   */
  abort(actor: string, id: string): Promise<GameState> {
    const userId = identifier(actor);
    return this.store.locked(identifier(id), async (manager, state) => {
      participatingPlayer(state, userId);
      if (await this.clocks.settle(manager, state.game)) {
        await manager.save(Game, state.game);
        return this.store.state(manager, state.game);
      }
      if (state.moves.length >= 2)
        throw new GameError(
          'ABORT_TOO_LATE',
          'A game can only be aborted before both players have moved.',
        );
      return this.finishAborted(manager, state);
    });
  }

  /** Background sweep: the side to move missed its first-move deadline. */
  async abortIfDue(id: string): Promise<boolean> {
    let aborted = false;
    await this.store.tryLocked(identifier(id), async (manager, state) => {
      const last =
        state.moves.at(-1)?.createdAt ?? state.game.startedAt ?? new Date();
      const now = await this.store.now(manager);
      if (
        state.game.status !== 'ACTIVE' ||
        state.moves.length >= 2 ||
        state.players.some((player) => player.botDifficulty) ||
        now.getTime() - last.getTime() < FIRST_MOVE_SECONDS * 1000
      )
        return;
      if (await this.clocks.settle(manager, state.game)) {
        await manager.save(Game, state.game);
        return;
      }
      await this.finishAborted(manager, state);
      aborted = true;
    });
    return aborted;
  }

  /**
   * The opponent left the game: the caller (the realtime service, which tracks
   * who is connected) has checked that they have been away long enough.
   */
  claimAbandonment(actor: string, id: string): Promise<GameState> {
    const userId = identifier(actor);
    return this.store.locked(identifier(id), async (manager, state) => {
      const player = participatingPlayer(state, userId);
      if (state.players.some((seat) => seat.botDifficulty))
        throw new GameError(
          'CLAIM_NOT_ALLOWED',
          'A bot never leaves its game.',
        );
      if (!(await this.clocks.settle(manager, state.game))) {
        if (state.moves.length < 2) return this.finishAborted(manager, state);
        finishGame(
          state.game,
          player.color === 'WHITE' ? 'WHITE_WIN' : 'BLACK_WIN',
          'ABANDONED',
        );
        this.clocks.stop(state.game);
      }
      await manager.save(Game, state.game);
      return this.store.state(manager, state.game);
    });
  }

  private async finishAborted(
    manager: EntityManager,
    state: GameState,
  ): Promise<GameState> {
    finishGame(state.game, null, 'ABORTED');
    this.clocks.stop(state.game);
    await manager.save(Game, state.game);
    return this.store.state(manager, state.game);
  }

  /**
   * Plays a human move. In a bot game the bot answers before this returns,
   * unless `waitForBot` is false: the caller then runs `resumeBot` itself.
   */
  async play(
    actor: string,
    id: string,
    input: string,
    { waitForBot = true }: { waitForBot?: boolean } = {},
  ): Promise<GameState> {
    const userId = identifier(actor),
      gameId = identifier(id),
      uci = moveInput(input);
    const observed = await this.store.get(gameId);
    const botGame = observed.players.some((seat) => seat.botDifficulty);
    const state = await this.store.locked(
      gameId,
      async (manager, state) => {
        participatingPlayer(state, userId);
        if (state.game.botLeaseToken)
          throw new GameError('GAME_BUSY', 'The bot is calculating its turn.');
        const player = activePlayer(state, userId);
        return this.persistMove(manager, state, player, uci);
      },
      botGame,
    );
    // A bot failure never converts an already accepted human move into an API error.
    return botGame && waitForBot ? this.resumeBot(userId, gameId) : state;
  }

  async createBot(
    actor: string,
    input: CreateGameInput,
    difficulty: BotDifficulty,
  ): Promise<GameState> {
    const userId = identifier(actor);
    if (!BOT_DIFFICULTIES.includes(difficulty))
      throw new GameError('INVALID_GAME_INPUT', 'Unsupported bot difficulty.');
    const { initialTime, increment, color, initialFen, opponentId } =
      creationInput(input);
    if (opponentId !== null)
      throw new GameError(
        'INVALID_GAME_INPUT',
        'Bot games cannot invite another user.',
      );
    const snapshot = await this.rules.analyze({ fen: initialFen });
    if (snapshot.status !== 'ongoing')
      throw new GameError(
        'INVALID_GAME_INPUT',
        'An ongoing position is required.',
      );
    const state = await this.store.transaction(async (manager) => {
      // Serializes concurrent creates from the same account across replicas.
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user)
        throw new GameError('USER_NOT_FOUND', 'Player account does not exist.');
      if ((await this.store.activeBotGames(manager, userId)) >= 1) {
        throw new GameError(
          'BOT_GAME_LIMIT',
          'Finish or resign your active bot game before creating another.',
        );
      }
      const game = manager.create(Game, {
        initialTime,
        increment,
        rated: false,
        initialFen: snapshot.fen,
        currentFen: snapshot.fen,
        turn: snapshot.turn.toUpperCase() as 'WHITE' | 'BLACK',
        status: 'ACTIVE',
        startedAt: new Date(),
      });
      this.clocks.initialize(game);
      await manager.save(Game, game);
      await manager.save(GamePlayer, [
        manager.create(GamePlayer, { gameId: game.id, userId, color }),
        manager.create(GamePlayer, {
          gameId: game.id,
          userId: null,
          color: color === 'WHITE' ? 'BLACK' : 'WHITE',
          botDifficulty: difficulty,
        }),
      ]);
      await this.clocks.start(manager, game);
      game.startedAt = new Date(game.clock!.updatedAt);
      await manager.save(Game, game);
      return this.store.state(manager, game);
    });
    this.presence?.setGameStatus(state.game.id, [userId], true);
    // This also computes White's opening move when the human chooses Black.
    return this.resumeBot(userId, state.game.id);
  }

  resumeBot(actor: string, id: string): Promise<GameState> {
    const runner = new BotTurnRunner(
      this.store,
      this.rules,
      this.clocks,
      this.bot,
      this.pacer,
    );
    return runner.run(
      identifier(actor),
      identifier(id),
      (manager, state, seat, uci, validated) =>
        this.persistMove(manager, state, seat, uci, validated),
    );
  }

  private async persistMove(
    manager: EntityManager,
    state: GameState,
    player: GamePlayer,
    uci: string,
    validated?: { before: ChessSnapshot; after: ChessSnapshot },
  ): Promise<GameState> {
    if (await this.clocks.settle(manager, state.game)) {
      await manager.save(Game, state.game);
      return this.store.state(manager, state.game);
    }
    const before = validated?.before ?? (await this.rules.current(state));
    const snapshot =
      validated?.after ?? (await this.rules.play(state, before, uci));
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
    const forcedDraw = mandatoryDraw(snapshot);
    if (result !== null) {
      const reason = snapshot.checkmate
        ? 'CHECKMATE'
        : snapshot.stalemate
          ? 'STALEMATE'
          : 'INSUFFICIENT_MATERIAL';
      finishGame(game, result, reason);
      this.clocks.stop(game);
    } else if (forcedDraw !== null) {
      finishGame(game, 'DRAW', forcedDraw);
      this.clocks.stop(game);
    }
    await manager.save(Game, game);
    return this.store.state(manager, game);
  }

  /**
   * The player to move claims a draw by threefold repetition or the fifty-move
   * rule; without a reason, whichever applies. A legal intended move is examined
   * without becoming part of the stored history.
   */
  async claimDraw(
    actor: string,
    id: string,
    reason?: DrawClaim,
    intendedMove?: string,
  ): Promise<GameState> {
    const userId = identifier(actor);
    if (
      reason !== undefined &&
      !['THREEFOLD_REPETITION', 'FIFTY_MOVE'].includes(reason)
    ) {
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
      const threefold = reason !== 'FIFTY_MOVE' && snapshot.threefoldClaimable;
      const fiftyMove =
        reason !== 'THREEFOLD_REPETITION' && snapshot.fiftyMoveClaimable;
      if (!threefold && !fiftyMove)
        throw new GameError(
          'DRAW_NOT_CLAIMABLE',
          'The rules engine does not confirm this draw claim.',
        );
      finishGame(
        state.game,
        'DRAW',
        threefold ? 'THREEFOLD_REPETITION' : 'FIFTY_MOVE_RULE',
      );
      this.clocks.stop(state.game);
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

function activeGameExists(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'ACTIVE_GAME_EXISTS',
    message: 'A player already has an active game.',
  });
}
