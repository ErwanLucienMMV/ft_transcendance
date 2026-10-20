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
      botLeaseToken: null,
      botLeaseUntil: null,
      botError: null,
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
  let busy = false,
    working = saved;
  const manager = {
    findOne: vi.fn(async () => ({ id: human })),
    create: (_entity, value) => ({
      id: gameId,
      ...value,
      createdAt: new Date(),
    }),
    save: async (entity, value) => {
      if (entity === Move) working.moves.push(value);
      else if (Array.isArray(value)) working.players = value;
      else working.game = value;
      return value;
    },
  };
  const transaction = async (action) => {
    if (busy) throw new GameError('GAME_BUSY', 'Another action is running.');
    busy = true;
    working = structuredClone(saved);
    try {
      const result = await action(manager, working);
      saved = structuredClone(working);
      return structuredClone(result);
    } finally {
      busy = false;
    }
  };
  const store = {
    get: vi.fn(async () => structuredClone(saved)),
    state: vi.fn(async (_manager, game) => ({ ...working, game })),
    locked: vi.fn(async (_id, action) => transaction(action)),
    transaction: vi.fn(async (action) =>
      transaction((manager) => action(manager)),
    ),
    now: vi.fn(async () => new Date()),
    activeBotGames: vi.fn(async () => 0),
  };
  const rules = {
    analyze: vi.fn(async () => positions[0]),
    current: vi.fn(async (state) => {
      if (state.moves.length === 1) expect(busy).toBe(false);
      return positions[state.moves.length];
    }),
    move: vi.fn(async (state) => {
      if (state.moves.length === 1) expect(busy).toBe(false);
      return positions[state.moves.length + 1];
    }),
  };
  const clocks = {
    settle: vi.fn(async () => false),
    move: vi.fn(async () => {}),
    stop: vi.fn(),
    initialize: vi.fn(),
    start: vi.fn(async (_manager, game) => {
      game.clock = { updatedAt: Date.now() };
    }),
  };
  const bestMove = vi.fn(async (): Promise<BotMove> => {
    expect(busy).toBe(false);
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
    get busy() {
      return busy;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Bot turns with short database leases', () => {
  it('searches and validates outside transactions, then persists SAN, board and clocks', async () => {
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
    expect(result.game.botLeaseToken).toBeNull();
    expect(f.bestMove).toHaveBeenCalledWith(
      { fen: initialFen, moves: ['e2e4'] },
      'MEDIUM',
    );
    expect(f.clocks.move).toHaveBeenCalledTimes(2);
  });
  it.each([new GameError('BOT_UNAVAILABLE', 'Offline'), new Error('Timeout')])(
    'returns the accepted human move and pending bot state after %s',
    async (error) => {
      const f = fixture();
      f.bestMove.mockRejectedValueOnce(error);
      const accepted = await f.service.play(f.human, f.gameId, 'e2e4');
      expect(accepted.moves.map((move) => move.uci)).toEqual(['e2e4']);
      expect(accepted.game).toMatchObject({
        turn: 'BLACK',
        botLeaseToken: null,
        botError: 'BOT_UNAVAILABLE',
      });
      expect((await f.service.resumeBot(f.human, f.gameId)).moves).toHaveLength(
        2,
      );
      expect((await f.service.resumeBot(f.human, f.gameId)).moves).toHaveLength(
        2,
      );
      expect(f.saved.game.botError).toBeNull();
      expect(f.bestMove).toHaveBeenCalledTimes(2);
    },
  );
  for (const corruption of ['illegal', 'stale', 'fenAfter']) {
    it(`discards ${corruption} replies without failing the human request`, async () => {
      const f = fixture();
      const result = await f.bestMove();
      if (corruption === 'illegal') result.bestMove = 'e7e4';
      if (corruption === 'stale') result.fen = initialFen;
      if (corruption === 'fenAfter') result.fenAfter = initialFen;
      f.bestMove.mockResolvedValue(result);
      const state = await f.service.play(f.human, f.gameId, 'e2e4');
      expect(state.moves).toHaveLength(1);
      expect(state.game).toMatchObject({
        currentFen: afterE4,
        botError: 'INVALID_BOT_RESPONSE',
        botLeaseToken: null,
      });
    });
  }
  it('keeps the database free while blocking human moves and coalescing duplicate searches', async () => {
    const f = fixture(),
      work = deferred<BotMove>(),
      started = deferred<void>();
    const reply = await f.bestMove();
    f.bestMove.mockClear();
    f.bestMove.mockImplementationOnce(() => {
      started.resolve();
      return work.promise;
    });
    const play = f.service.play(f.human, f.gameId, 'e2e4');
    await started.promise;
    expect(f.busy).toBe(false);
    expect((await f.store.get(f.gameId)).game.botLeaseToken).toBeTruthy();
    await expect(
      f.service.play(f.human, f.gameId, 'g1f3'),
    ).rejects.toMatchObject({ code: 'GAME_BUSY' });
    const pending = await f.service.resumeBot(f.human, f.gameId);
    expect(pending.moves).toHaveLength(1);
    expect(f.bestMove).toHaveBeenCalledTimes(1);
    work.resolve(reply);
    expect((await play).moves).toHaveLength(2);
  });
  it('discards a late result after resignation', async () => {
    const f = fixture(),
      work = deferred<BotMove>(),
      started = deferred<void>();
    const reply = await f.bestMove();
    f.bestMove.mockImplementationOnce(() => {
      started.resolve();
      return work.promise;
    });
    const play = f.service.play(f.human, f.gameId, 'e2e4');
    await started.promise;
    f.saved.game.status = 'FINISHED';
    f.saved.game.botLeaseToken = null;
    f.saved.game.botLeaseUntil = null;
    work.resolve(reply);
    const result = await play;
    expect(result.game.status).toBe('FINISHED');
    expect(result.moves).toHaveLength(1);
  });
  it('expires abandoned leases and prevents the old worker from overwriting a new claim', async () => {
    const f = fixture(),
      old = deferred<BotMove>(),
      fresh = deferred<BotMove>();
    const started = deferred<void>(),
      restarted = deferred<void>(),
      reply = await f.bestMove();
    f.bestMove.mockImplementationOnce(() => {
      started.resolve();
      return old.promise;
    });
    const play = f.service.play(f.human, f.gameId, 'e2e4');
    await started.promise;
    const oldToken = f.saved.game.botLeaseToken;
    f.saved.game.botLeaseUntil = new Date(0);
    f.bestMove.mockImplementationOnce(() => {
      restarted.resolve();
      return fresh.promise;
    });
    const retry = f.service.resumeBot(f.human, f.gameId);
    await restarted.promise;
    const token = f.saved.game.botLeaseToken;
    expect(token).not.toBe(oldToken);
    old.resolve(reply);
    expect((await play).moves).toHaveLength(1);
    expect(f.saved.game.botLeaseToken).toBe(token);
    fresh.resolve(reply);
    expect((await retry).moves).toHaveLength(2);
  });
  it('discards a result if the position changes before the save transaction', async () => {
    const f = fixture(),
      work = deferred<BotMove>(),
      started = deferred<void>();
    const reply = await f.bestMove();
    f.bestMove.mockImplementationOnce(() => {
      started.resolve();
      return work.promise;
    });
    const play = f.service.play(f.human, f.gameId, 'e2e4');
    await started.promise;
    f.saved.game.currentFen = afterE5;
    work.resolve(reply);
    const state = await play;
    expect(state.moves).toHaveLength(1);
    expect(state.game.botLeaseToken).toBeNull();
  });
  it('does not insert a bot move after clock expiry', async () => {
    const f = fixture();
    f.bestMove.mockImplementationOnce(async () => {
      f.clocks.settle.mockImplementationOnce(async (_manager, game) => {
        game.status = 'FINISHED';
        game.botLeaseToken = null;
        game.botLeaseUntil = null;
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
  it('starts the White bot automatically when the human chooses Black', async () => {
    const f = fixture();
    f.bestMove.mockResolvedValue({
      bestMove: 'e2e4',
      fen: initialFen,
      fenAfter: afterE4,
      difficulty: 'MEDIUM',
      status: 'ongoing',
      depth: 1,
      nodes: 30,
      elapsedMs: 1,
      scoreCp: 0,
    });
    const state = await f.service.createBot(
      f.human,
      { initialTime: 300000, color: 'BLACK' },
      'MEDIUM',
    );
    expect(state.moves.map((move) => move.uci)).toEqual(['e2e4']);
    expect(state.game.turn).toBe('BLACK');
  });
  it('returns a durable id and pending state if the White bot cannot open', async () => {
    const f = fixture();
    f.bestMove.mockRejectedValue(new Error('Offline'));
    const state = await f.service.createBot(
      f.human,
      { initialTime: 300000, color: 'BLACK' },
      'MEDIUM',
    );
    expect(state.game.id).toBeTruthy();
    expect(state.game.botError).toBe('BOT_UNAVAILABLE');
    expect(state.moves).toHaveLength(0);
  });
  it('limits active bot games under an account row lock', async () => {
    const f = fixture();
    f.store.activeBotGames.mockResolvedValue(1);
    await expect(
      f.service.createBot(f.human, { initialTime: 300000 }, 'MEDIUM'),
    ).rejects.toMatchObject({ code: 'BOT_GAME_LIMIT' });
    expect(f.bestMove).not.toHaveBeenCalled();
  });
  it('rejects spectators and bot-seat identities', async () => {
    const f = fixture();
    await expect(
      f.service.resumeBot(randomUUID(), f.gameId),
    ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
    await expect(
      f.service.play(f.saved.players[1].id, f.gameId, 'e2e4'),
    ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
  });
});
