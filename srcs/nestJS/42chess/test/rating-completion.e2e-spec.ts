import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { GamesService } from '../dist/games/games.service.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-481 completed games expose durable ELO updates', () => {
  let app: INestApplication<App>, source: DataSource, games: GamesService;
  let white: User, black: User, gameId: string | undefined;
  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    games = app.get(GamesService);
  });
  beforeEach(async () => {
    [white, black] = await source.getRepository(User).save(
      ['white', 'black'].map((color) => ({
        username: `elo_${color}_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      })),
    );
    const state = await games.create(white.id, {
      initialTime: 300000,
      increment: 0,
      color: 'WHITE',
    });
    gameId = state.game.id;
    await games.join(black.id, gameId);
  });
  afterEach(async () => {
    if (gameId) {
      await source.query('DELETE FROM rating_history WHERE "gameId" = $1', [
        gameId,
      ]);
      await source.query('DELETE FROM games WHERE id = $1', [gameId]);
      gameId = undefined;
    }
    for (const user of [white, black])
      if (user) await source.getRepository(User).delete(user.id);
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['checkmate', 'draw', 'timeout', 'resignation'] as const)(
    'publishes exactly one pair of rating changes after %s',
    async (outcome) => {
      if (outcome === 'checkmate') {
        for (const [actor, move] of [
          [white.id, 'f2f3'],
          [black.id, 'e7e5'],
          [white.id, 'g2g4'],
          [black.id, 'd8h4'],
        ])
          await games.play(actor, gameId!, move);
      } else if (outcome === 'draw') {
        await games.offerDraw(white.id, gameId!);
        await games.acceptDraw(black.id, gameId!);
      } else if (outcome === 'resignation') {
        await games.resign(black.id, gameId!);
      } else {
        const state = await games.get(gameId!);
        await source.query(
          'UPDATE games SET clock = $1, "clockDeadline" = now() - interval \'1 second\' WHERE id = $2',
          [
            { ...state.game.clock, white: 1, updatedAt: Date.now() - 10000 },
            gameId,
          ],
        );
      }
      const draw = outcome === 'draw';
      const whiteChange = draw ? 0 : outcome === 'resignation' ? 16 : -16;
      const response = await request(app.getHttpServer())
        .get(`/v1/games/${gameId}`)
        .expect(200);
      expect(response.body).toMatchObject({
        status: 'FINISHED',
        result: {
          winner: draw ? null : whiteChange > 0 ? 'WHITE' : 'BLACK',
          reason:
            outcome === 'checkmate'
              ? 'CHECKMATE'
              : draw
                ? 'DRAW_AGREEMENT'
                : outcome === 'resignation'
                  ? 'RESIGNATION'
                  : 'TIMEOUT',
        },
        whitePlayer: { id: white.id, elo: 1200 + whiteChange },
        blackPlayer: { id: black.id, elo: 1200 - whiteChange },
      });
      const histories: unknown[] = [];
      for (const [user, change] of [
        [white, whiteChange],
        [black, draw ? 0 : -whiteChange],
      ] as const) {
        const history = await request(app.getHttpServer())
          .get(`/v1/users/${user.id}/rating-history`)
          .expect(200);
        expect(history.body.history).toHaveLength(1);
        expect(history.body.history[0]).toMatchObject({
          gameId,
          ratingBefore: 1200,
          ratingAfter: 1200 + change,
          change,
        });
        expect(history.body.history[0].createdAt).toMatch(/Z$/);
        histories.push(history.body);
        const stored = await source
          .getRepository(User)
          .findOneByOrFail({ id: user.id });
        expect(stored).toMatchObject({
          elo: 1200 + change,
          gamesPlayed: 1,
          gamesDraw: Number(draw),
          gamesWon: Number(change > 0),
          gamesLost: Number(change < 0),
        });
      }
      const before = await source.query(
        'SELECT * FROM users WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[white.id, black.id]],
      );
      await Promise.all(
        Array.from({ length: 4 }, () =>
          request(app.getHttpServer()).get(`/v1/games/${gameId}`).expect(200),
        ),
      );
      expect(
        await source.query(
          'SELECT * FROM users WHERE id = ANY($1::uuid[]) ORDER BY id',
          [[white.id, black.id]],
        ),
      ).toEqual(before);
      for (const [index, user] of [white, black].entries()) {
        expect(
          (
            await request(app.getHttpServer())
              .get(`/v1/users/${user.id}/rating-history`)
              .expect(200)
          ).body,
        ).toEqual(histories[index]);
      }
      expect(
        await source.query(
          'SELECT id FROM rating_history WHERE "gameId" = $1',
          [gameId],
        ),
      ).toHaveLength(2);
    },
  );
});
