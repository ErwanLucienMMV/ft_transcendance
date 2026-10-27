import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';

// The bot routes live in their own module; this checks they accept a real session bearer.
describe('Bot game routes with a real session', () => {
  let app: INestApplication, source: DataSource, user: User;
  const created: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    source = app.get(DataSource);
    user = await source.getRepository(User).save(
      source.getRepository(User).create({
        username: `bot_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      }),
    );
  });
  afterAll(async () => {
    for (const id of created) {
      await source.query('DELETE FROM moves WHERE "gameId" = $1', [id]);
      await source.query('DELETE FROM game_players WHERE "gameId" = $1', [id]);
      await source.query('DELETE FROM games WHERE id = $1', [id]);
    }
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });

  it('creates a bot game for the signed-in player and refuses anonymous callers', async () => {
    const body = {
      difficulty: 'EASY',
      color: 'WHITE',
      timeControl: { initialTime: 600000, increment: 0 },
    };
    await request(app.getHttpServer())
      .post('/v1/games/bot')
      .send(body)
      .expect(401);
    const { accessToken } = await app.get(SessionService).issue(user);
    const response = await request(app.getHttpServer())
      .post('/v1/games/bot')
      .auth(accessToken, { type: 'bearer' })
      .send(body)
      .expect(201);
    created.push(response.body.gameId);
    expect(response.body).toMatchObject({
      status: 'ACTIVE',
      whitePlayer: { id: user.id },
      blackPlayer: { botDifficulty: 'EASY' },
    });
    await request(app.getHttpServer())
      .post(`/v1/games/${response.body.gameId}/bot-move`)
      .auth(accessToken, { type: 'bearer' })
      .expect(201);
  });
});
