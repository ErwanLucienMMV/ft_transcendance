import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-103 case-insensitive username search', () => {
  let app: INestApplication<App>, source: DataSource;
  let users: User[] = [];
  const suffix = randomUUID().slice(0, 8);
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    users = await source.getRepository(User).save([
      { username: `a_${suffix}_ChEsS`, emailVerifiedAt: new Date() },
      { username: `b_${suffix}Xchess`, emailVerifiedAt: new Date() },
      {
        username: `unrelated_${suffix}`,
        email: `hidden_${suffix}@example.com`,
        emailVerifiedAt: new Date(),
      },
    ]);
  });
  afterAll(async () => {
    for (const user of users) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  const search = async (q: string) =>
    (
      await request(app.getHttpServer())
        .get('/v1/users/search')
        .query({ q })
        .expect(200)
    ).body.users;
  it('matches case-insensitive substrings and orders the public results deterministically', async () => {
    const results = await search(suffix.toUpperCase());
    expect(results.map((user: { id: string }) => user.id)).toEqual(
      users.map((user) => user.id),
    );
    expect(results[0]).toEqual({
      id: users[0].id,
      username: users[0].username,
      elo: 1200,
      online: false,
    });
    expect(
      (await search(`${suffix}_cHe`)).map((user: { id: string }) => user.id),
    ).toEqual([users[0].id]);
  });
  it('treats underscores, percent and backslash as literal characters', async () => {
    expect(
      (await search(`${suffix}_`)).map((user: { id: string }) => user.id),
    ).toEqual([users[0].id]);
    expect(await search(`${suffix}%`)).toEqual([]);
    expect(await search(`${suffix}\\`)).toEqual([]);
  });
  it('does not match private email addresses', async () => {
    expect(await search(`hidden_${suffix}`)).toEqual([]);
  });
});
