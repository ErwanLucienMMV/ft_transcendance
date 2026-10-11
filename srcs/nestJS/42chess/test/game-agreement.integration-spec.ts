import { gameFixture } from './game-service.fixture.js';
import { AddGameAgreements1791740100000 } from '../dist/database/migrations/1791740100000-AddGameAgreements.js';

describe('Draw offers and resignation', () => {
  const f = gameFixture();

  it('persists an offer and permits the opponent to accept out of turn', async () => {
    const { game } = await f.active();
    expect((await f.service.get(game.id)).game.drawOffer).toBeNull();
    await f.service.offerDraw(f.white, game.id);
    expect((await f.service.get(game.id)).game.drawOffer).toBe('WHITE');
    const ended = await f.service.acceptDraw(f.black, game.id);
    expect(ended.game).toMatchObject({
      status: 'FINISHED',
      result: 'DRAW',
      drawOffer: null,
      endReason: 'DRAW_AGREEMENT',
    });
    expect(ended.game.finishedAt).toBeInstanceOf(Date);
    expect(ended.moves).toEqual([]);
  });

  it('rejects duplicate and simultaneous offers without replacing the first', async () => {
    const { game } = await f.active();
    const results = await Promise.allSettled([
      f.service.offerDraw(f.white, game.id),
      f.service.offerDraw(f.black, game.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'DRAW_ALREADY_OFFERED' },
    });
    const offered = await f.service.get(game.id);
    const actor = offered.game.drawOffer === 'WHITE' ? f.white : f.black;
    await expect(f.service.offerDraw(actor, game.id)).rejects.toMatchObject({
      code: 'DRAW_ALREADY_OFFERED',
    });
    expect(await f.service.get(game.id)).toEqual(offered);
  });

  it.each(['acceptDraw', 'declineDraw'] as const)(
    'requires an opponent offer to %s',
    async (method) => {
      const { game } = await f.active();
      await expect(f.service[method](f.black, game.id)).rejects.toMatchObject({
        code: 'DRAW_NOT_OFFERED',
      });
      const offered = await f.service.offerDraw(f.white, game.id);
      await expect(f.service[method](f.white, game.id)).rejects.toMatchObject({
        code: 'OWN_DRAW_OFFER',
      });
      expect(await f.service.get(game.id)).toEqual(offered);
    },
  );

  it('declines an offer without changing position and permits another offer', async () => {
    const before = await f.active();
    await f.service.offerDraw(f.white, before.game.id);
    const declined = await f.service.declineDraw(f.black, before.game.id);
    expect(declined.game).toMatchObject({
      status: 'ACTIVE',
      result: null,
      drawOffer: null,
      currentFen: before.game.currentFen,
    });
    expect(
      (await f.service.offerDraw(f.black, before.game.id)).game.drawOffer,
    ).toBe('BLACK');
  });

  it('clears the offer only after a successfully committed move', async () => {
    const { game } = await f.active();
    const offered = await f.service.offerDraw(f.black, game.id);
    await expect(
      f.service.play(f.white, game.id, 'e2e5'),
    ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    expect(await f.service.get(game.id)).toEqual(offered);
    expect(
      (await f.service.play(f.white, game.id, 'e2e4')).game.drawOffer,
    ).toBeNull();
    await expect(f.service.acceptDraw(f.white, game.id)).rejects.toMatchObject({
      code: 'DRAW_NOT_OFFERED',
    });
  });

  it.each(['WHITE', 'BLACK'] as const)(
    'awards the opponent a win when %s resigns regardless of turn',
    async (color) => {
      const { game } = await f.active();
      await f.service.offerDraw(f.white, game.id);
      const ended = await f.service.resign(
        color === 'WHITE' ? f.white : f.black,
        game.id,
      );
      expect(ended.game).toMatchObject({
        status: 'FINISHED',
        result: color === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN',
        drawOffer: null,
        endReason: 'RESIGNATION',
      });
      expect(ended.game.finishedAt).toBeInstanceOf(Date);
      expect(ended.moves).toEqual([]);
      await expect(
        f.service.play(f.white, game.id, 'e2e4'),
      ).rejects.toMatchObject({ code: 'GAME_ALREADY_FINISHED' });
    },
  );

  it.each(['offerDraw', 'acceptDraw', 'declineDraw', 'resign'] as const)(
    'rejects outsiders, waiting and finished games for %s',
    async (method) => {
      const { game } = await f.service.create(f.white, { initialTime: 300000 });
      await expect(f.service[method](f.white, game.id)).rejects.toMatchObject({
        code: 'GAME_NOT_ACTIVE',
      });
      await f.service.join(f.black, game.id);
      const before = await f.service.offerDraw(f.white, game.id);
      await expect(
        f.service[method](f.outsider, game.id),
      ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
      expect(await f.service.get(game.id)).toEqual(before);
      const ended = await f.service.resign(f.black, game.id);
      await expect(f.service[method](f.white, game.id)).rejects.toMatchObject({
        code: 'GAME_ALREADY_FINISHED',
      });
      expect(await f.service.get(game.id)).toEqual(ended);
    },
  );

  it('serializes accepting versus resigning with exactly one terminal result', async () => {
    const { game } = await f.active();
    await f.service.offerDraw(f.white, game.id);
    const results = await Promise.allSettled([
      f.service.acceptDraw(f.black, game.id),
      f.service.resign(f.white, game.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'GAME_ALREADY_FINISHED' },
    });
    const ended = await f.service.get(game.id);
    expect(ended.game.status).toBe('FINISHED');
    expect(['DRAW', 'BLACK_WIN']).toContain(ended.game.result);
    expect(ended.game.drawOffer).toBeNull();
  });

  it('clears an offer on a successful rules-based draw claim', async () => {
    const { game } = await f.active('7k/8/8/8/8/8/R7/K7 w - - 100 51');
    await f.service.offerDraw(f.black, game.id);
    expect(
      (await f.service.claimDraw(f.white, game.id, 'FIFTY_MOVE')).game
        .drawOffer,
    ).toBeNull();
  });

  it('rejects persisted offers on waiting or finished games and invalid reasons', async () => {
    const { game } = await f.service.create(f.white, { initialTime: 60000 });
    await expect(
      f.source.query('UPDATE games SET "drawOffer" = $1 WHERE id = $2', [
        'WHITE',
        game.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await f.service.join(f.black, game.id);
    await expect(
      f.source.query('UPDATE games SET "drawOffer" = $1 WHERE id = $2', [
        'GREEN',
        game.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      f.source.query('UPDATE games SET "endReason" = $1 WHERE id = $2', [
        'RESIGNATION',
        game.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await f.service.resign(f.white, game.id);
    await expect(
      f.source.query('UPDATE games SET "drawOffer" = $1 WHERE id = $2', [
        'WHITE',
        game.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('rolls back agreement columns without losing games, players or moves', async () => {
    const { game } = await f.active();
    await f.service.play(f.white, game.id, 'e2e4');
    const runner = f.source.createQueryRunner();
    const migration = new AddGameAgreements1791740100000();
    await migration.down(runner);
    try {
      const [row] = await f.source.query(
        'SELECT "currentFen" FROM games WHERE id = $1',
        [game.id],
      );
      expect(row.currentFen).toContain(' b ');
      expect(await f.count('moves')).toBe(1);
      expect(await f.count('game_players')).toBe(2);
    } finally {
      await migration.up(runner);
      await runner.release();
    }
    expect((await f.service.get(game.id)).game.drawOffer).toBeNull();
  });
});
