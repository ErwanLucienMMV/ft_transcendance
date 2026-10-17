import { randomUUID } from 'node:crypto';
import { GamesService } from '../games/games.service.js';
import { GameError } from '../games/game-error.js';
import { Move } from '../games/move.entity.js';
import type { GameState } from '../games/game-state.js';
import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import type { BotMove } from './bot-engine.js';

const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
function snapshot(
  fen: string,
  turn: 'white' | 'black',
  legalMoves: string[],
): ChessSnapshot {
  return {
    fen,
    turn,
    legalMoves,
    check: false,
    checkmate: false,
    stalemate: false,
    insufficientMaterial: false,
    status: 'ongoing',
    winner: null,
    repetitionCount: 1,
    threefoldClaimable: false,
    fiftyMoveClaimable: false,
  };
}
const positions = [
  snapshot(initialFen, 'white', ['e2e4']),
  snapshot(afterE4, 'black', ['e7e5']),
  snapshot(afterE5, 'white', ['g1f3']),
];
function fixture() {
  const human = randomUUID(),
    gameId = randomUUID();
  let saved = {
    game: {
      id: gameId,
      status: 'ACTIVE',
      initialFen,
      currentFen: initialFen,
      turn: 'WHITE',
      drawOffer: null,
    },
    players: [
      {
        id: randomUUID(),
        gameId,
        userId: human,
        color: 'WHITE',
        botDifficulty: null,
      },
      {
        id: randomUUID(),
        gameId,
        userId: null,
        color: 'BLACK',
        botDifficulty: 'MEDIUM',
      },
    ],
    moves: [],
  } as unknown as GameState;
  let busy = false;
  // A transaction double tests orchestration/rollback, not PostgreSQL locking.
  // The separate integration suite verifies the real DB constraints and NOWAIT.
  const store = {
    get: vi.fn(async () => structuredClone(saved)),
    state: vi.fn(async (_manager, game) => ({ ...saved, game })),
    locked: vi.fn(async (_id, action, failIfBusy) => {
      expect(failIfBusy).toBe(true);
      if (busy) throw new GameError('GAME_BUSY', 'Another action is running.');
      busy = true;
      const before = structuredClone(saved);
      const manager = {
        create: (_entity, value) => ({
          ...value,
          id: randomUUID(),
          createdAt: new Date(),
        }),
        save: async (entity, value) => {
          if (entity === Move) saved.moves.push(value);
          return value;
        },
      };
      try {
        return await action(manager, saved);
      } catch (error) {
        saved = before;
        throw error;
      } finally {
        busy = false;
      }
    }),
  };
  const rules = {
    current: vi.fn(async (state) => positions[state.moves.length]),
    move: vi.fn(async (state) => positions[state.moves.length + 1]),
  };
  const clocks = {
    settle: vi.fn(async () => false),
    move: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const bestMove = vi.fn(async (): Promise<BotMove> => ({
    bestMove: 'e7e5',
    fen: afterE4,
    fenAfter: afterE5,
    difficulty: 'MEDIUM',
    status: 'ongoing',
    depth: 3,
    nodes: 100,
    elapsedMs: 1,
    scoreCp: 0,
  }));
  const service = new GamesService(
    store as never,
    rules as never,
    {} as never,
    clocks as never,
    { bestMove },
  );
  return {
    service,
    human,
    gameId,
    store,
    rules,
    clocks,
    bestMove,
    get saved() {
      return saved;
    },
  };
}

describe('Bot turns through the normal persistence path', () => {
  it('persists contiguous human and bot moves with SAN, updated board and clocks', async () => {
    const f = fixture();
    const result = await f.service.play(f.human, f.gameId, 'e2e4');
    expect(
      result.moves.map((move) => [move.ply, move.uci, move.notation]),
    ).toEqual([
      [1, 'e2e4', 'e4'],
      [2, 'e7e5', 'e5'],
    ]);
    expect(result.game.currentFen).toBe(afterE5);
    expect(result.game.turn).toBe('WHITE');
    expect(f.bestMove).toHaveBeenCalledWith(
      { fen: initialFen, moves: ['e2e4'] },
      'MEDIUM',
    );
    expect(f.clocks.move).toHaveBeenCalledTimes(2);
  });
  it('retains the committed human move after a bot failure, then retries only the bot', async () => {
    const f = fixture();
    f.bestMove.mockRejectedValueOnce(
      new GameError('BOT_UNAVAILABLE', 'Offline'),
    );
    await expect(
      f.service.play(f.human, f.gameId, 'e2e4'),
    ).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
    expect(f.saved.moves.map((move) => move.uci)).toEqual(['e2e4']);
    expect(f.saved.game.turn).toBe('BLACK');
    expect((await f.service.resumeBot(f.human, f.gameId)).moves).toHaveLength(
      2,
    );
    expect((await f.service.resumeBot(f.human, f.gameId)).moves).toHaveLength(
      2,
    );
    expect(f.bestMove).toHaveBeenCalledTimes(2);
  });
  for (const corruption of ['illegal', 'stale', 'fenAfter']) {
    it(`rejects a ${corruption} result atomically`, async () => {
      const f = fixture();
      const result = await f.bestMove();
      if (corruption === 'illegal') result.bestMove = 'e7e4';
      if (corruption === 'stale') result.fen = initialFen;
      if (corruption === 'fenAfter') result.fenAfter = initialFen;
      f.bestMove.mockResolvedValue(result);
      await expect(
        f.service.play(f.human, f.gameId, 'e2e4'),
      ).rejects.toMatchObject({ code: 'INVALID_BOT_RESPONSE' });
      expect(f.saved.moves).toHaveLength(1);
      expect(f.saved.game.currentFen).toBe(afterE4);
    });
  }
  it('rejects human moves and duplicate bot searches while calculation holds the lock', async () => {
    const f = fixture();
    let release!: (result: BotMove) => void;
    const result = await f.bestMove();
    let started!: () => void;
    const calculating = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.bestMove.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const play = f.service.play(f.human, f.gameId, 'e2e4');
    await calculating;
    await expect(
      f.service.play(f.human, f.gameId, 'g1f3'),
    ).rejects.toMatchObject({ code: 'GAME_BUSY' });
    await expect(f.service.resumeBot(f.human, f.gameId)).rejects.toMatchObject({
      code: 'GAME_BUSY',
    });
    release(result);
    expect((await play).moves).toHaveLength(2);
  });
  it('prevents spectators and bot-seat IDs from acting as the human', async () => {
    const f = fixture();
    await expect(
      f.service.resumeBot(randomUUID(), f.gameId),
    ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
    await expect(
      f.service.play(f.saved.players[1].id, f.gameId, 'e2e4'),
    ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
    expect(f.bestMove).not.toHaveBeenCalled();
  });
  it('never stores a bot move after its clock expires during search', async () => {
    const f = fixture();
    f.bestMove.mockImplementationOnce(async () => {
      f.clocks.settle.mockImplementationOnce(async (_manager, game) => {
        game.status = 'FINISHED';
        game.endReason = 'TIMEOUT';
        return true;
      });
      return {
        bestMove: 'e7e5',
        fen: afterE4,
        fenAfter: afterE5,
        difficulty: 'MEDIUM',
        status: 'ongoing',
        depth: 3,
        nodes: 100,
        elapsedMs: 1,
        scoreCp: 0,
      };
    });
    const state = await f.service.play(f.human, f.gameId, 'e2e4');
    expect(state.moves).toHaveLength(1);
    expect(state.game.endReason).toBe('TIMEOUT');
  });
});
