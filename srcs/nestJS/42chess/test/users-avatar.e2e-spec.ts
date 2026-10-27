import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sessionToken } from './session.fixture.js';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-98 avatar editing', () => {
  let app: INestApplication<App>, source: DataSource, user: User, token: string;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    user = await source
      .getRepository(User)
      .save({
        username: `avatar_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      });
    token = await sessionToken(app, user.id);
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  const patch = (body: object) =>
    request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  it('replaces and clears the stored avatar without changing the username', async () => {
    for (const avatarUrl of [
      'https://example.com/a.png',
      'http://example.com/b.jpg',
      null,
    ]) {
      const response = await patch({ avatarUrl }).expect(200);
      expect(response.body).toMatchObject({
        id: user.id,
        username: user.username,
        avatarUrl,
      });
      expect(
        (await source.getRepository(User).findOneByOrFail({ id: user.id }))
          .avatarUrl,
      ).toBe(avatarUrl);
    }
  });
  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///tmp/avatar.png',
    'ftp://example.com/avatar.png',
    '//example.com/a.png',
    'https://name:password@example.com/a.png',
    'not a url',
    '',
    12,
    false,
    {},
    [],
    `https://example.com/${'x'.repeat(2048)}`,
  ])(
    'rejects invalid avatars without partially renaming the account: %j',
    async (avatarUrl) => {
      const before = await source
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      await patch({ avatarUrl, username: 'avatar_valid_rename' }).expect(400);
      expect(
        await source.getRepository(User).findOneByOrFail({ id: user.id }),
      ).toEqual(before);
    },
  );
  it('leaves the avatar unchanged when the property is omitted', async () => {
    const avatarUrl = 'https://example.com/keep.png';
    await patch({ avatarUrl }).expect(200);
    expect((await patch({}).expect(200)).body.avatarUrl).toBe(avatarUrl);
  });
});
