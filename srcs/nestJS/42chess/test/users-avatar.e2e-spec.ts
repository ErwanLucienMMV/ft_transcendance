import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sessionToken } from './session.fixture.js';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

describe('SCRUM-98 avatar editing', () => {
  let app: INestApplication<App>,
    source: DataSource,
    user: User,
    token: string,
    avatars: string;
  beforeAll(async () => {
    avatars = await mkdtemp(join(tmpdir(), 'avatars-e2e-'));
    process.env.AVATAR_DIR = avatars;
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    user = await source.getRepository(User).save({
      username: `avatar_${randomUUID().slice(0, 8)}`,
      emailVerifiedAt: new Date(),
    });
    token = await sessionToken(app, user.id);
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
    delete process.env.AVATAR_DIR;
    await rm(avatars, { recursive: true, force: true });
  });
  const patch = (body: object) =>
    request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const upload = () =>
    request(app.getHttpServer())
      .post('/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', PNG, 'avatar.png');
  it('replaces and clears the stored avatar without changing the username', async () => {
    for (const step of ['upload', 'upload', 'remove']) {
      const response = await (
        step === 'upload'
          ? upload()
          : request(app.getHttpServer())
              .delete('/v1/users/me/avatar')
              .set('Authorization', `Bearer ${token}`)
      ).expect(200);
      expect(response.body).toMatchObject({
        id: user.id,
        username: user.username,
      });
      const stored = await source
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(stored.avatarUrl).toBe(response.body.avatarUrl);
      expect(stored.username).toBe(user.username);
      if (step === 'remove') expect(stored.avatarUrl).toBeNull();
    }
  });
  it.each([
    'https://example.com/a.png',
    null,
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
    'refuses an avatar given as a value, without partially renaming the account: %j',
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
  it('leaves the avatar unchanged when the profile is patched', async () => {
    const { avatarUrl } = (await upload().expect(200)).body as {
      avatarUrl: string;
    };
    expect((await patch({}).expect(200)).body.avatarUrl).toBe(avatarUrl);
    expect(
      (await patch({ preferences: { soundEnabled: false } }).expect(200)).body
        .avatarUrl,
    ).toBe(avatarUrl);
  });
});
