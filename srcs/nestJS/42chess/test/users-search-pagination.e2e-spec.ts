import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-104 bounded user-search pagination', () => {
  let app: INestApplication<App>, source: DataSource;
  let users: User[] = [],
    expected: User[] = [];
  const prefix = `page_${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    users = await source.getRepository(User).save(
      Array.from({ length: 25 }, (_, index) => ({
        username: `${prefix}_${String(24 - index).padStart(2, '0')}`,
        emailVerifiedAt: new Date(),
      })),
    );
    expected = [...users].sort((a, b) => a.username.localeCompare(b.username));
  });
  afterAll(async () => {
    for (const user of users) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  const search = async (pagination: object = {}) =>
    (
      await request(app.getHttpServer())
        .get('/v1/users/search')
        .query({ q: prefix, ...pagination })
        .expect(200)
    ).body.users as { id: string }[];
  it('defaults to 20 ordered results and retrieves the remainder without duplicates', async () => {
    const first = await search();
    const second = await search({ limit: 5, offset: 20 });
    expect(first.map((user) => user.id)).toEqual(
      expected.slice(0, 20).map((user) => user.id),
    );
    expect(second.map((user) => user.id)).toEqual(
      expected.slice(20).map((user) => user.id),
    );
    expect(new Set([...first, ...second].map((user) => user.id)).size).toBe(25);
    expect(await search()).toEqual(first);
  });
  it('supports both page bounds and an offset beyond the matches', async () => {
    expect(
      (await search({ limit: 1, offset: 3 })).map((user) => user.id),
    ).toEqual([expected[3].id]);
    expect(await search({ limit: 100 })).toHaveLength(25);
    expect(await search({ offset: 25 })).toEqual([]);
  });
  it.each([
    { limit: 0 },
    { limit: -1 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: 'NaN' },
    { limit: 'Infinity' },
    { limit: [1, 2] },
    { offset: -1 },
    { offset: 1.5 },
    { offset: 'NaN' },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { page: 2 },
  ])('rejects invalid pagination %j', async (pagination) => {
    const response = await request(app.getHttpServer())
      .get('/v1/users/search')
      .query({ q: prefix, ...pagination })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});
