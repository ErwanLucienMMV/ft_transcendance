import { GameRealtimeService } from './game-realtime.service.js';
import type { RealtimeClient } from './realtime-messages.js';
import type { GamesService } from '../games/games.service.js';
import type { GamePresenterService } from '../games/game-presenter.service.js';
import { GameError } from '../games/game-error.js';
import { apiError } from '../common/api-error.js';
import { SpectatorRegistry } from '../games/spectator-registry.js';
import type { DataSource } from 'typeorm';

const id = '00000000-0000-4000-8000-000000000001';
const white = '00000000-0000-4000-8000-000000000002';
const black = '00000000-0000-4000-8000-000000000003';

describe('Game realtime routing and rooms', () => {
  let service: GameRealtimeService;
  let games: Record<string, ReturnType<typeof vi.fn>>;
  let state: any;
  let source: { query: ReturnType<typeof vi.fn> };
  let a: RealtimeClient, b: RealtimeClient;
  let registry: SpectatorRegistry;
  beforeEach(() => {
    registry = new SpectatorRegistry();
    state = {
      game: {
        id,
        status: 'ACTIVE',
        currentFen: 'fen',
        turn: 'WHITE',
        result: null,
      },
      players: [{ userId: white }, { userId: black }],
      moves: [],
    };
    games = Object.fromEntries(
      [
        'get',
        'settle',
        'join',
        'play',
        'resign',
        'offerDraw',
        'acceptDraw',
        'declineDraw',
      ].map((name) => [name, vi.fn(async () => structuredClone(state))]),
    );
    const presenter = {
      state: vi.fn(async (value: typeof state) => ({
        id,
        status: value.game.status,
        board: { fen: value.game.currentFen, turn: value.game.turn },
        clocks: { white: 5000, black: 5000 },
        result: value.game.result,
        drawOffer: value.game.drawOffer ? { playerId: white } : null,
      })),
      moves: vi.fn((value: typeof state) => ({ moves: value.moves })),
    };
    source = { query: vi.fn(async () => [{ now: new Date(1793181600000) }]) };
    service = new GameRealtimeService(
      games as unknown as GamesService,
      presenter as unknown as GamePresenterService,
      registry,
      source as unknown as DataSource,
    );
    a = {
      userId: white,
      connectionId: 'a',
      connected: () => true,
      send: vi.fn(),
    };
    b = {
      userId: black,
      connectionId: 'b',
      connected: () => true,
      send: vi.fn(),
    };
  });
  afterEach(() => service.onModuleDestroy());
  async function join(client = a) {
    await service.handle(client, { event: 'JOIN_GAME', data: { gameId: id } });
  }
  async function command(event: string, client = a, extra = {}) {
    await service.handle(client, { event, data: { gameId: id, ...extra } });
  }
  it('sends a full snapshot and permits idempotent reconnects for seated players', async () => {
    await join();
    await join();
    expect(games.join).not.toHaveBeenCalled();
    expect(a.send).toHaveBeenCalledWith(
      'GAME_STATE',
      expect.objectContaining({
        gameId: id,
        board: expect.anything(),
        moves: [],
      }),
    );
  });
  it('samples the durable database clock and validates room sync requests', async () => {
    state.game.clock = { updatedAt: 1793181600000, status: 'RUNNING' };
    await expect(
      command('SYNC_CLOCK', a, { requestId: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await join();
    await command('SYNC_CLOCK', a, { requestId: 7 });
    expect(a.send).toHaveBeenCalledWith(
      'CLOCK_SYNC',
      expect.objectContaining({
        gameId: id,
        requestId: 7,
        serverTime: new Date(state.game.clock.updatedAt).toISOString(),
        clockStatus: 'RUNNING',
        processingMs: expect.any(Number),
        sampleAgeMs: expect.any(Number),
      }),
    );
    await service.tick();
    expect(a.send).toHaveBeenCalledWith(
      'CLOCK_UPDATE',
      expect.objectContaining({
        serverTime: new Date(state.game.clock.updatedAt).toISOString(),
      }),
    );
    await expect(
      command('SYNC_CLOCK', a, { requestId: -1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      command('SYNC_CLOCK', a, { requestId: 1, clocks: {} }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('includes settlement commit latency in sample age using database time', async () => {
    const checkpoint = 1793181600000;
    state.game.clock = { updatedAt: checkpoint, status: 'RUNNING' };
    await join();
    let now = 0;
    const monotonic = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => now);
    const wall = vi.spyOn(Date, 'now').mockReturnValue(checkpoint + 3600000);
    try {
      games.settle.mockImplementation(async () => {
        // Checkpoint at 20ms, then 100ms of persistence/commit work.
        now = 120;
        return structuredClone(state);
      });
      source.query.mockImplementation(async () => {
        now = 140;
        return [{ now: new Date(checkpoint + 110) }];
      });
      await command('SYNC_CLOCK', a, { requestId: 8 });
      expect(a.send).toHaveBeenCalledWith(
        'CLOCK_SYNC',
        expect.objectContaining({
          serverTime: new Date(checkpoint).toISOString(),
          processingMs: 140,
          sampleAgeMs: 120,
        }),
      );
      expect(source.query).toHaveBeenCalledWith(
        'SELECT clock_timestamp() AS now',
      );
    } finally {
      monotonic.mockRestore();
      wall.mockRestore();
    }
  });
  it('refuses outsiders without subscribing them', async () => {
    await expect(join({ ...a, userId: 'outsider' })).rejects.toMatchObject({
      code: 'NOT_A_PLAYER',
    });
    expect(a.send).not.toHaveBeenCalled();
  });
  it('takes an available waiting seat through the existing domain service', async () => {
    state.game.status = 'WAITING';
    state.players = [{ userId: white }];
    await join(b);
    expect(games.join).toHaveBeenCalledWith(black, id);
  });
  it('requires room membership before mutation', async () => {
    await expect(command('RESIGN')).rejects.toMatchObject({ status: 403 });
    expect(games.resign).not.toHaveBeenCalled();
  });
  it.each([
    { userId: black },
    { from: 'e2', to: 'e4', clocks: {} },
    { from: 'e2', to: 'e9' },
    { from: 'e2', to: 'e4', promotion: 'KING' },
  ])('refuses extra or malformed move fields: %j', async (data) => {
    await join();
    await expect(command('MAKE_MOVE', a, data)).rejects.toThrow();
    expect(games.play).not.toHaveBeenCalled();
  });
  it('binds moves to the authenticated actor, broadcasts to the room and preserves promotion', async () => {
    await join();
    await join(b);
    games.play.mockImplementation(async () => {
      const next = structuredClone(state);
      next.moves.push({
        from: 'a7',
        to: 'a8',
        promotion: 'KNIGHT',
        notation: 'a8=N',
      });
      return next;
    });
    await command('MAKE_MOVE', a, {
      from: 'a7',
      to: 'a8',
      promotion: 'KNIGHT',
    });
    expect(games.play).toHaveBeenCalledWith(white, id, 'a7a8n');
    for (const client of [a, b])
      expect(client.send).toHaveBeenCalledWith(
        'MOVE_PLAYED',
        expect.objectContaining({
          gameId: id,
          move: expect.objectContaining({ promotion: 'KNIGHT' }),
        }),
      );
  });
  const e4 = {
    from: 'e2',
    to: 'e4',
    notation: 'e4',
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  };
  const e5 = {
    from: 'e7',
    to: 'e5',
    notation: 'e5',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  };
  function events(client: RealtimeClient) {
    return vi.mocked(client.send).mock.calls.map(([event]) => event);
  }
  function played(client: RealtimeClient) {
    return vi
      .mocked(client.send)
      .mock.calls.filter(([event]) => event === 'MOVE_PLAYED')
      .map(([, data]) => data);
  }
  it('announces every ply committed by one move, in order, before the snapshot', async () => {
    await join();
    await join(b);
    vi.mocked(a.send).mockClear();
    games.play.mockImplementation(async () => {
      // A bot game commits the human move and the bot reply together.
      const next = structuredClone(state);
      next.moves.push(e4, e5);
      next.game.currentFen = e5.fen;
      return next;
    });
    await command('MAKE_MOVE', a, { from: 'e2', to: 'e4' });
    for (const client of [a, b])
      expect(played(client)).toEqual([
        expect.objectContaining({
          gameId: id,
          move: e4,
          board: expect.objectContaining({ fen: e4.fen, turn: 'BLACK' }),
          turn: 'BLACK',
        }),
        expect.objectContaining({
          gameId: id,
          move: e5,
          board: expect.objectContaining({ fen: e5.fen }),
          turn: 'WHITE',
        }),
      ]);
    expect(events(a)).toEqual(['MOVE_PLAYED', 'MOVE_PLAYED', 'GAME_STATE']);
  });
  it('announces moves committed outside the socket at the next refresh', async () => {
    await join();
    state.moves.push(e4);
    state.game.currentFen = e4.fen;
    state.game.turn = 'BLACK';
    vi.mocked(a.send).mockClear();
    await service.tick();
    expect(played(a)).toEqual([
      expect.objectContaining({ move: e4, turn: 'BLACK' }),
    ]);
    expect(events(a).slice(0, 2)).toEqual(['MOVE_PLAYED', 'GAME_STATE']);
    await service.tick();
    expect(played(a)).toHaveLength(1);
  });
  it('does not replay earlier moves to a player joining the room', async () => {
    state.moves.push(e4, e5);
    await join();
    await join(b);
    expect(played(a)).toEqual([]);
    expect(played(b)).toEqual([]);
  });
  it('preserves domain errors without notifying the other player', async () => {
    await join();
    await join(b);
    vi.mocked(a.send).mockClear();
    vi.mocked(b.send).mockClear();
    games.play.mockRejectedValue(new GameError('WRONG_TURN', 'Not your turn.'));
    try {
      await command('MAKE_MOVE', a, { from: 'e2', to: 'e4' });
      throw new Error('Expected refusal');
    } catch (error) {
      expect(apiError(error).code).toBe('NOT_YOUR_TURN');
    }
    expect(b.send).not.toHaveBeenCalled();
    expect(a.send).not.toHaveBeenCalled();
  });
  it('leaves a room without resigning and stops refreshes when nobody remains', async () => {
    await join();
    await command('LEAVE_GAME');
    vi.mocked(a.send).mockClear();
    games.settle.mockClear();
    await service.tick();
    expect(games.resign).not.toHaveBeenCalled();
    expect(games.settle).not.toHaveBeenCalled();
    expect(a.send).not.toHaveBeenCalled();
  });
  it('cleans memberships at disconnect without resigning', async () => {
    await join();
    service.disconnect('a');
    await expect(command('RESIGN')).rejects.toMatchObject({ status: 403 });
    expect(games.resign).not.toHaveBeenCalled();
  });
  it('does not subscribe a client that disconnects while its snapshot is loading', async () => {
    let connected = true;
    a.connected = () => connected;
    games.settle.mockImplementation(async () => {
      connected = false;
      return state;
    });
    await join();
    expect(a.send).not.toHaveBeenCalled();
    games.settle.mockClear();
    await service.tick();
    expect(games.settle).not.toHaveBeenCalled();
  });
  it('publishes durable clocks, a terminal result once, then no further ticks', async () => {
    await join();
    await service.tick();
    expect(a.send).toHaveBeenCalledWith(
      'CLOCK_UPDATE',
      expect.objectContaining({
        gameId: id,
        clocks: { white: 5000, black: 5000 },
      }),
    );
    state.game.status = 'FINISHED';
    state.game.result = { winner: 'BLACK', reason: 'TIMEOUT' };
    await service.tick();
    await service.tick();
    const terminal = vi
      .mocked(a.send)
      .mock.calls.filter(([event]) => event === 'GAME_ENDED');
    expect(terminal).toHaveLength(1);
  });
  it.each([
    ['RESIGN', 'resign'],
    ['OFFER_DRAW', 'offerDraw'],
    ['ACCEPT_DRAW', 'acceptDraw'],
    ['DECLINE_DRAW', 'declineDraw'],
  ])('routes %s through %s with the trusted player', async (event, method) => {
    await join();
    await command(event);
    expect(games[method]).toHaveBeenCalledWith(white, id);
  });

  describe('spectators (SPEC-01..10)', () => {
    const viewer = (name: string, userId = `user-${name}`): RealtimeClient => ({
      userId,
      connectionId: name,
      connected: () => true,
      send: vi.fn(),
    });
    const watch = (client: RealtimeClient) =>
      service.handle(client, {
        event: 'START_SPECTATING',
        data: { gameId: id },
      });
    const counts = (client: RealtimeClient) =>
      vi
        .mocked(client.send)
        .mock.calls.filter(([event]) => event === 'GAME_STATE')
        .map(([, data]) => (data as { spectatorCount: number }).spectatorCount);

    it('sends the current state to a new spectator without seating them', async () => {
      const s1 = viewer('s1');
      await watch(s1);
      expect(games.join).not.toHaveBeenCalled();
      expect(s1.send).toHaveBeenCalledWith(
        'GAME_STATE',
        expect.objectContaining({ gameId: id, moves: [], spectatorCount: 1 }),
      );
      expect(registry.count(id)).toBe(1);
    });

    it('refuses a game that has not started, and any extra field', async () => {
      state.game.status = 'WAITING';
      await expect(watch(viewer('s1'))).rejects.toMatchObject({
        code: 'GAME_NOT_ACTIVE',
      });
      state.game.status = 'ACTIVE';
      await expect(
        service.handle(viewer('s2'), {
          event: 'START_SPECTATING',
          data: { gameId: id, color: 'WHITE' },
        }),
      ).rejects.toThrow();
      expect(registry.count(id)).toBe(0);
    });

    it('broadcasts moves and the end of the game to every spectator', async () => {
      const [s1, s2] = [viewer('s1'), viewer('s2')];
      await join();
      await watch(s1);
      await watch(s2);
      games.play.mockImplementation(async () => {
        const next = structuredClone(state);
        next.moves.push(e4);
        next.game.currentFen = e4.fen;
        return next;
      });
      await command('MAKE_MOVE', a, { from: 'e2', to: 'e4' });
      for (const client of [s1, s2])
        expect(played(client)).toEqual([expect.objectContaining({ move: e4 })]);
      games.resign.mockImplementation(async () => {
        const next = structuredClone(state);
        next.game.status = 'FINISHED';
        next.game.result = { winner: 'BLACK', reason: 'RESIGNATION' };
        return next;
      });
      await command('RESIGN');
      for (const client of [s1, s2])
        expect(
          events(client).filter((event) => event === 'GAME_ENDED'),
        ).toHaveLength(1);
    });

    it.each([
      'MAKE_MOVE',
      'RESIGN',
      'OFFER_DRAW',
      'ACCEPT_DRAW',
      'DECLINE_DRAW',
    ])(
      'refuses %s from a spectator, even a seated user who chose to watch',
      async (event) => {
        const seated = viewer('watching-white', white);
        await watch(seated);
        const extra = event === 'MAKE_MOVE' ? { from: 'e2', to: 'e4' } : {};
        await expect(command(event, seated, extra)).rejects.toMatchObject({
          response: { code: 'SPECTATOR_READ_ONLY' },
        });
        for (const method of [
          'play',
          'resign',
          'offerDraw',
          'acceptDraw',
          'declineDraw',
        ])
          expect(games[method]).not.toHaveBeenCalled();
      },
    );

    it('counts distinct users, tells the room, and stops on STOP_SPECTATING or disconnect', async () => {
      await join();
      const [s1, s1Again, s2] = [
        viewer('s1'),
        viewer('s1-tab', 'user-s1'),
        viewer('s2'),
      ];
      await watch(s1);
      await watch(s1Again);
      expect(registry.count(id)).toBe(1);
      await watch(s2);
      expect(registry.count(id)).toBe(2);
      expect(counts(a)).toEqual([0, 1, 2]);

      await service.handle(s2, {
        event: 'STOP_SPECTATING',
        data: { gameId: id },
      });
      expect(s2.send).toHaveBeenLastCalledWith('GAME_LEFT', { gameId: id });
      expect(registry.count(id)).toBe(1);
      expect(counts(a).at(-1)).toBe(1);
      service.disconnect('s1');
      expect(registry.count(id)).toBe(1); // the other tab still watches
      service.disconnect('s1-tab');
      expect(registry.count(id)).toBe(0);
      expect(counts(a).at(-1)).toBe(0);

      vi.mocked(s2.send).mockClear();
      await service.tick();
      expect(s2.send).not.toHaveBeenCalled();
    });

    it('lets a seated player switch from watching to playing with JOIN_GAME', async () => {
      const seated = viewer('white-tab', white);
      await watch(seated);
      expect(registry.count(id)).toBe(1);
      await join(seated);
      expect(registry.count(id)).toBe(0);
      await command('RESIGN', seated);
      expect(games.resign).toHaveBeenCalledWith(white, id);
    });

    it('answers STOP_SPECTATING from a player with an error, keeping the seat', async () => {
      await join();
      await expect(command('STOP_SPECTATING')).rejects.toMatchObject({
        response: { code: 'NOT_SPECTATING' },
      });
      await command('RESIGN');
      expect(games.resign).toHaveBeenCalled();
    });

    it('sends the end to a spectator who arrives after the game finished', async () => {
      await join();
      state.game.status = 'FINISHED';
      state.game.result = { winner: 'WHITE', reason: 'CHECKMATE' };
      await service.tick();
      const late = viewer('late');
      await watch(late);
      expect(
        events(late).filter((event) => event === 'GAME_ENDED'),
      ).toHaveLength(1);
      expect(events(late)).toEqual(['GAME_STATE', 'GAME_ENDED']);
    });
  });
});
