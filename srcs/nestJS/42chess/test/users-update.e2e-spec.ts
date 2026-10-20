import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-96 profile patch (real JWT and database)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  let owner: User, other: User;
  let token: string;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    [owner, other] = await source.getRepository(User).save(
      ['owner', 'other'].map((name) => ({
        username: `${name}_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      })),
    );
    token = await new JwtService().signAsync(
      { sub: owner.id },
      {
        secret: process.env.JWT_SECRET,
        algorithm: 'HS256',
        expiresIn: 60,
      },
    );
  });
  afterAll(async () => {
    for (const user of [owner, other])
      if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  const patch = (body: unknown) =>
    request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  it('persists a partial update only for the authenticated account', async () => {
    const beforeOther = await source
      .getRepository(User)
      .findOneByOrFail({ id: other.id });
    const avatarUrl = 'https://example.com/avatar.png';
    const response = await patch({ avatarUrl }).expect(200);
    expect(response.body).toMatchObject({
      id: owner.id,
      username: owner.username,
      avatarUrl,
    });
    expect(
      (await source.getRepository(User).findOneByOrFail({ id: owner.id }))
        .avatarUrl,
    ).toBe(avatarUrl);
    expect(
      await source.getRepository(User).findOneByOrFail({ id: other.id }),
    ).toEqual(beforeOther);
  });
  it('allows an empty patch and rejects null usernames', async () => {
    const before = await source
      .getRepository(User)
      .findOneByOrFail({ id: owner.id });
    await patch({}).expect(200);
    await patch({ username: null }).expect(400);
    expect(
      await source.getRepository(User).findOneByOrFail({ id: owner.id }),
    ).toEqual(before);
  });
  it.each([
    { elo: 9999 },
    { id: randomUUID() },
    { email: 'attacker@example.com' },
    { passwordHash: 'forged' },
    { gamesWon: 999 },
    { twoFactorSecret: 'forged' },
  ])('rejects protected fields atomically: %j', async (input) => {
    const before = await source
      .getRepository(User)
      .findOneByOrFail({ id: owner.id });
    const response = await patch({ avatarUrl: null, ...input }).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(
      await source.getRepository(User).findOneByOrFail({ id: owner.id }),
    ).toEqual(before);
  });
  it('requires authentication before any mutation', async () => {
    await request(app.getHttpServer())
      .patch('/v1/users/me')
      .send({ avatarUrl: null })
      .expect(401);
  });
});
