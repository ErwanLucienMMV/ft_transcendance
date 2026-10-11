import { randomUUID } from 'node:crypto';
import { gameFixture, INITIAL_FEN } from './game-service.fixture.js';

describe('Game creation and lifecycle', () => {
  const f = gameFixture();

  it('creates WAITING with the creator in one seat and default position/increment', async () => {
    const state = await f.service.create(f.white, { initialTime: 60000 });
    expect(state.game).toMatchObject({
      status: 'WAITING',
      initialTime: 60000,
      increment: 0,
      initialFen: INITIAL_FEN,
      currentFen: INITIAL_FEN,
      turn: 'WHITE',
      result: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(state.players).toMatchObject([{ userId: f.white, color: 'WHITE' }]);
    expect(state.moves).toEqual([]);
    expect(await f.service.get(state.game.id)).toEqual(state);
  });

  it('joins the opposite color and atomically starts the game', async () => {
    const created = await f.service.create(f.white, {
      initialTime: 60000,
      color: 'BLACK',
    });
    const state = await f.service.join(f.black, created.game.id);
    expect(state.game.status).toBe('ACTIVE');
    expect(state.game.startedAt).toBeInstanceOf(Date);
    expect(state.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: f.white, color: 'BLACK' }),
        expect.objectContaining({ userId: f.black, color: 'WHITE' }),
      ]),
    );
  });

  it('initializes both FENs and turn from a custom black-to-move position', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const state = await f.service.create(f.white, {
      initialTime: 60000,
      initialFen: fen,
    });
    expect(state.game).toMatchObject({
      initialFen: fen,
      currentFen: fen,
      turn: 'BLACK',
    });
  });

  it.each([
    { initialTime: 0 },
    { initialTime: -1 },
    { initialTime: 1.5 },
    { initialTime: 2147483648 },
    { initialTime: NaN },
    { initialTime: 60000, increment: -1 },
    { initialTime: 60000, increment: 0.5 },
    { initialTime: 60000, increment: 2147483648 },
    { initialTime: 60000, color: 'GREEN' },
    { initialTime: 60000, initialFen: '' },
    { initialTime: 60000, initialFen: 'not a FEN' },
    { initialTime: 60000, extra: true },
  ])(
    'rejects invalid creation input without storing anything: %j',
    async (input) => {
      await expect(
        f.service.create(f.white, input as never),
      ).rejects.toMatchObject({ code: 'INVALID_GAME_INPUT' });
      expect(await f.count('games')).toBe(0);
      expect(await f.count('game_players')).toBe(0);
    },
  );

  it('rejects an already finished initial position', async () => {
    await expect(
      f.service.create(f.white, {
        initialTime: 60000,
        initialFen: '7k/8/8/8/8/8/8/K7 w - - 0 1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GAME_INPUT' });
    expect(await f.count('games')).toBe(0);
  });

  it('rejects missing users without leaving an orphan game', async () => {
    await expect(
      f.service.create(randomUUID(), { initialTime: 60000 }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(await f.count('games')).toBe(0);
  });

  it('rejects a second seat by the creator', async () => {
    const { game } = await f.service.create(f.white, { initialTime: 60000 });
    await expect(f.service.join(f.white, game.id)).rejects.toMatchObject({
      code: 'ALREADY_JOINED',
    });
    expect(await f.count('game_players')).toBe(1);
    expect((await f.service.get(game.id)).game.status).toBe('WAITING');
  });

  it('rejects a third player without changing the started game', async () => {
    const before = await f.active();
    await expect(
      f.service.join(f.outsider, before.game.id),
    ).rejects.toMatchObject({ code: 'GAME_NOT_WAITING' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('serializes concurrent joins', async () => {
    const { game } = await f.service.create(f.white, { initialTime: 60000 });
    const results = await Promise.allSettled([
      f.service.join(f.black, game.id),
      f.service.join(f.outsider, game.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'GAME_NOT_WAITING' } });
    const state = await f.service.get(game.id);
    expect(state.players).toHaveLength(2);
    expect(state.game.status).toBe('ACTIVE');
  });

  it.each(['bad-id', '', '00000000-0000-0000-0000-00000000000z'])(
    'rejects malformed game identifiers: %s',
    async (id) => {
      await expect(f.service.get(id)).rejects.toMatchObject({
        code: 'INVALID_GAME_INPUT',
      });
    },
  );

  it('reports missing games separately from invalid identifiers', async () => {
    await expect(f.service.get(randomUUID())).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
  });
});
