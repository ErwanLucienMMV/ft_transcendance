import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
// Exercise the compiled application, including TypeScript decorator metadata.
import { AppModule } from './../dist/app.module.js';
import { DataSource } from 'typeorm';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let database: DataSource;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    database = app.get(DataSource);
  });

  it('serves health while connected to PostgreSQL', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body.services[0]).toMatchObject({ name: 'database', status: 'up' });
    expect(
      (body.services as { name: string }[]).map((service) => service.name),
    ).toEqual(['database', 'chess-engine', 'bot', 'mail']);
    expect(body.backup).toHaveProperty('maxAgeSeconds', 7200);
    expect(await database.query('SELECT 1 AS connected')).toEqual([
      { connected: 1 },
    ]);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ name: '42chess API', version: 'v1' });
  });

  afterEach(async () => {
    await app.close();
    expect(database.isInitialized).toBe(false);
  });
});
