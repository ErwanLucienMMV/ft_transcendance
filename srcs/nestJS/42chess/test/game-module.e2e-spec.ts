import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { GamesService } from '../dist/games/games.service.js';

describe('GamesModule application integration', () => {
  let app: INestApplication;
  let source: DataSource;
  let gameId: string | undefined;
  let userId: string | undefined;

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    source = app.get(DataSource);
  });

  afterAll(async () => {
    try {
      if (gameId)
        await source.query('DELETE FROM games WHERE id = $1', [gameId]);
      if (userId)
        await source.query('DELETE FROM users WHERE id = $1', [userId]);
    } finally {
      await app?.close();
    }
  });

  it('resolves the service and creates a game using the migrated application database', async () => {
    const service = app.get(GamesService);
    const [user] = await source.query(
      'INSERT INTO users (username) VALUES ($1) RETURNING id',
      [`module_${randomUUID().replaceAll('-', '').slice(0, 20)}`],
    );
    userId = user.id as string;
    const state = await service.create(userId, { initialTime: 60000 });
    gameId = state.game.id;
    expect(state.game.status).toBe('WAITING');
    expect(state.players[0].userId).toBe(userId);
    expect(await service.get(gameId)).toEqual(state);
  });
});
