import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import { Game } from '../games/game.entity.js';
import type { GamePlayer } from '../games/game-player.entity.js';
import type { GameState } from '../games/game-state.js';
import { GameStoreService } from '../games/game-store.service.js';
import { GameRulesService } from '../games/game-rules.service.js';
import { GameClocksService } from '../games/clock/game-clocks.service.js';
import { GameError } from '../games/game-error.js';
import { moveInput } from '../games/game-input.js';
import { BotEngine } from './bot-engine.js';

interface ValidatedMove {
  before: ChessSnapshot;
  after: ChessSnapshot;
}
interface PreparedTurn {
  state: GameState;
  token: string | null;
}
type SaveMove = (
  manager: EntityManager,
  state: GameState,
  seat: GamePlayer,
  uci: string,
  validated: ValidatedMove,
) => Promise<GameState>;

/** Per-request coordinator. Only claim/finish/fail touch transactions. */
export class BotTurnRunner {
  constructor(
    private readonly store: GameStoreService,
    private readonly rules: GameRulesService,
    private readonly clocks: GameClocksService,
    private readonly bot?: BotEngine,
  ) {}

  async run(
    userId: string,
    gameId: string,
    saveMove: SaveMove,
  ): Promise<GameState> {
    const prepared = await this.claim(userId, gameId);
    if (prepared.token === null) return prepared.state;
    const { state: expected, token } = prepared;
    const seat = expected.players.find(
      (seat) => seat.color === expected.game.turn && seat.botDifficulty,
    )!;
    let validated: ValidatedMove & { uci: string };
    try {
      validated = await this.calculate(expected, seat);
    } catch (error) {
      return this.fail(gameId, token, error);
    }
    return this.finish(gameId, token, expected, seat, validated, saveMove);
  }

  private async claim(userId: string, gameId: string): Promise<PreparedTurn> {
    return this.store.locked(gameId, async (manager, state) => {
      if (!state.players.some((seat) => seat.userId === userId)) {
        throw new GameError(
          'NOT_A_PLAYER',
          'Only a participant may request a bot turn.',
        );
      }
      if (state.game.status !== 'ACTIVE') return { state, token: null };
      const seat = state.players.find(
        (seat) => seat.color === state.game.turn && seat.botDifficulty,
      );
      if (!seat) return { state, token: null };
      if (await this.clocks.settle(manager, state.game)) {
        await manager.save(Game, state.game);
        return {
          state: await this.store.state(manager, state.game),
          token: null,
        };
      }
      const now = await this.store.now(manager);
      if (
        state.game.botLeaseToken &&
        state.game.botLeaseUntil &&
        state.game.botLeaseUntil > now
      ) {
        return { state, token: null };
      }
      const token = randomUUID();
      state.game.botLeaseToken = token;
      // Longer than the adapter timeout + rules calls. A dead worker is retryable.
      state.game.botLeaseUntil = new Date(now.getTime() + 45000);
      state.game.botError = null;
      await manager.save(Game, state.game);
      return { state: await this.store.state(manager, state.game), token };
    });
  }

  private async calculate(
    expected: GameState,
    seat: GamePlayer,
  ): Promise<ValidatedMove & { uci: string }> {
    // All network/CPU work is outside any transaction or checked-out DB connection.
    const before = await this.rules.current(expected);
    if (!this.bot)
      throw new GameError('BOT_UNAVAILABLE', 'Bot adapter is not configured.');
    const result = await this.bot.bestMove(
      {
        fen: expected.game.initialFen,
        moves: expected.moves.map((move) => move.uci),
      },
      seat.botDifficulty!,
    );
    if (
      result.fen !== before.fen ||
      result.bestMove === null ||
      !before.legalMoves.includes(result.bestMove)
    ) {
      throw new GameError(
        'INVALID_BOT_RESPONSE',
        'Bot returned a stale or illegal move.',
      );
    }
    const uci = moveInput(result.bestMove);
    const after = await this.rules.move(expected, uci);
    if (result.fenAfter !== after.fen)
      throw new GameError(
        'INVALID_BOT_RESPONSE',
        'Bot and rules engine disagree on the resulting position.',
      );
    return { before, after, uci };
  }

  private async fail(
    gameId: string,
    token: string,
    error: unknown,
  ): Promise<GameState> {
    return this.store.locked(gameId, async (manager, state) => {
      if (state.game.botLeaseToken === token) {
        state.game.botLeaseToken = null;
        state.game.botLeaseUntil = null;
        state.game.botError =
          error instanceof GameError && error.code === 'INVALID_BOT_RESPONSE'
            ? 'INVALID_BOT_RESPONSE'
            : 'BOT_UNAVAILABLE';
        await this.clocks.settle(manager, state.game);
        await manager.save(Game, state.game);
      }
      return this.store.state(manager, state.game);
    });
  }

  private async finish(
    gameId: string,
    token: string,
    expected: GameState,
    seat: GamePlayer,
    validated: ValidatedMove & { uci: string },
    saveMove: SaveMove,
  ): Promise<GameState> {
    const { before, after, uci } = validated;
    return this.store.locked(gameId, async (manager, state) => {
      const now = await this.store.now(manager);
      if (state.game.botLeaseToken !== token) return state;
      const unchanged =
        state.game.status === 'ACTIVE' &&
        state.game.initialFen === expected.game.initialFen &&
        state.game.currentFen === expected.game.currentFen &&
        state.game.turn === expected.game.turn &&
        state.moves.length === expected.moves.length &&
        state.moves.every(
          (move, index) =>
            move.uci === expected.moves[index].uci &&
            move.fenAfter === expected.moves[index].fenAfter,
        ) &&
        state.players.some(
          (player) =>
            player.id === seat.id &&
            player.botDifficulty === seat.botDifficulty,
        );
      const validLease =
        state.game.botLeaseUntil !== null && state.game.botLeaseUntil > now;
      state.game.botLeaseToken = null;
      state.game.botLeaseUntil = null;
      if (!unchanged || !validLease) {
        await manager.save(Game, state.game);
        return this.store.state(manager, state.game);
      }
      state.game.botError = null;
      return saveMove(manager, state, seat, uci, { before, after });
    });
  }
}
