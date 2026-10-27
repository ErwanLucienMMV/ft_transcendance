import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sessionToken } from './session.fixture.js';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-97 username changes', () => {
  let app: INestApplication<App>, source: DataSource;
  let users: User[] = [];
  const tokens: string[] = [];
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    users = await source.getRepository(User).save(
      [0, 1].map(() => ({
        username: `rename_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      })),
    );
    for (const user of users) tokens.push(await sessionToken(app, user.id));
  });
  afterAll(async () => {
    for (const user of users) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  const patch = (index: number, body: object) =>
    request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokens[index]}`)
      .send(body);

  it('renames the owner, including case-only changes, without changing their identity or stats', async () => {
    const username = `Renamed_${randomUUID().slice(0, 8)}`;
    for (const name of [username, username.toUpperCase()]) {
      const response = await patch(0, { username: name }).expect(200);
      expect(response.body).toMatchObject({
        id: users[0].id,
        username: name,
        elo: 1200,
        gamesPlayed: 0,
      });
      expect(
        (await source.getRepository(User).findOneByOrFail({ id: users[0].id }))
          .username,
      ).toBe(name);
    }
  });
  it.each([
    'admin',
    'AdMiN',
    'me',
    'ab',
    'x'.repeat(33),
    'bad name',
    'bad@email',
    '',
    null,
    42,
  ])(
    'rejects reserved or malformed usernames without a partial avatar write: %j',
    async (username) => {
      const before = await source
        .getRepository(User)
        .findOneByOrFail({ id: users[0].id });
      await patch(0, {
        username,
        avatarUrl: 'https://example.com/new.png',
      }).expect(400);
      expect(
        await source.getRepository(User).findOneByOrFail({ id: users[0].id }),
      ).toEqual(before);
    },
  );
  it('returns a conflict for another account’s name regardless of case, with no partial write', async () => {
    const before = await source
      .getRepository(User)
      .findOneByOrFail({ id: users[0].id });
    const response = await patch(0, {
      username: users[1].username.toUpperCase(),
      avatarUrl: 'https://example.com/new.png',
    }).expect(409);
    expect(response.body.code).toBe('USERNAME_ALREADY_EXISTS');
    expect(
      await source.getRepository(User).findOneByOrFail({ id: users[0].id }),
    ).toEqual(before);
  });
  it('lets exactly one concurrent claimant acquire the same case-insensitive name', async () => {
    const username = `race_${randomUUID().slice(0, 8)}`;
    const responses = await Promise.all([
      patch(0, { username }),
      patch(1, { username: username.toUpperCase() }),
    ]);
    expect(
      responses.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(responses.find((result) => result.status === 409)?.body.code).toBe(
      'USERNAME_ALREADY_EXISTS',
    );
    const rows = await source.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [username],
    );
    expect(rows).toHaveLength(1);
  });
});
