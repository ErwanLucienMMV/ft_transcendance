import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { generate } from 'otplib';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { MailClient } from '../dist/mail/mail.client.js';
import { PasswordService } from '../dist/auth/password.service.js';
import { User } from '../dist/users/user.entity.js';

/** Stands in for forgemail: keeps every mail, newest last. */
class FakeMailClient {
  readonly sent: { kind: string; to: string; token?: string }[] = [];
  sendEmailVerification(to: string, _username: string, token: string) {
    this.sent.push({ kind: 'email-verification', to, token });
    return Promise.resolve();
  }
  /** Makes the next reset email fail, as when forgemail is down. */
  failNext = false;
  sendPasswordReset(to: string, _username: string, token: string) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('forgemail is down'));
    }
    this.sent.push({ kind: 'password-reset', to, token });
    return Promise.resolve();
  }
  notify(to: string | null, _username: string, kind: string) {
    if (to) this.sent.push({ kind, to });
    return Promise.resolve();
  }
  last(kind: string, to: string) {
    return this.sent.filter((m) => m.kind === kind && m.to === to).at(-1);
  }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);
const PASSWORD = 'correct horse battery';

describe('Account self-service (e2e)', () => {
  let app: INestApplication<App>;
  let database: DataSource;
  let avatars: string;
  const mail = new FakeMailClient();
  const http = () => request(app.getHttpServer());

  /** A verified account with a password, signed in. */
  async function account(prefix = 'acct') {
    const username = `${prefix}_${randomUUID().slice(0, 8)}`;
    const email = `${username}@example.com`;
    const passwordHash = await app.get(PasswordService).hash(PASSWORD);
    const user = await database.getRepository(User).save(
      database.getRepository(User).create({
        username,
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
      }),
    );
    const login = await http()
      .post('/v1/auth/login')
      .send({ login: username, password: PASSWORD })
      .expect(200);
    return {
      id: user.id,
      username,
      email,
      token: login.body.accessToken as string,
    };
  }

  beforeAll(async () => {
    avatars = await mkdtemp(join(tmpdir(), 'avatars-e2e-'));
    process.env.AVATAR_DIR = avatars;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailClient)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.AVATAR_DIR;
    await rm(avatars, { recursive: true, force: true });
  });

  describe('avatar', () => {
    it('uploads, serves, replaces and removes an avatar', async () => {
      const alice = await account();
      const uploaded = await http()
        .post('/v1/users/me/avatar')
        .auth(alice.token, { type: 'bearer' })
        .attach('avatar', PNG, {
          filename: 'me.txt',
          contentType: 'text/plain',
        })
        .expect(200);
      const first = uploaded.body.avatarUrl as string;
      expect(first).toMatch(
        new RegExp(`^avatars/${alice.id}-[0-9a-f]{16}\\.png$`),
      );
      const served = await http().get(`/v1/${first}`).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['cache-control']).toContain('immutable');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      // The session user carries the avatar, for the header.
      const me = await http()
        .get('/v1/users/me')
        .auth(alice.token, { type: 'bearer' })
        .expect(200);
      expect(me.body.avatarUrl).toBe(first);

      const replaced = await http()
        .post('/v1/users/me/avatar')
        .auth(alice.token, { type: 'bearer' })
        .attach('avatar', Buffer.concat([PNG, Buffer.from([0])]), 'me.png')
        .expect(200);
      expect(replaced.body.avatarUrl).not.toBe(first);
      await http().get(`/v1/${first}`).expect(404);

      await http()
        .delete('/v1/users/me/avatar')
        .auth(alice.token, { type: 'bearer' })
        .expect(200)
        .expect(({ body }) => expect(body.avatarUrl).toBeNull());
      await http().get(`/v1/${replaced.body.avatarUrl}`).expect(404);
    });

    it('refuses other formats, oversized files, missing files and free URLs', async () => {
      const bob = await account();
      const upload = (content: Buffer, name = 'a.png') =>
        http()
          .post('/v1/users/me/avatar')
          .auth(bob.token, { type: 'bearer' })
          .attach('avatar', content, name);
      await upload(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        'a.svg',
      )
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_AVATAR'));
      await upload(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])).expect(
        413,
      );
      await http()
        .post('/v1/users/me/avatar')
        .auth(bob.token, { type: 'bearer' })
        .expect(400);
      await http()
        .patch('/v1/users/me')
        .auth(bob.token, { type: 'bearer' })
        .send({ avatarUrl: 'https://tracker.example/pixel.png' })
        .expect(400);
      await http().get('/v1/avatars/..%2F..%2Fetc%2Fpasswd').expect(404);
      await http()
        .post('/v1/users/me/avatar')
        .attach('avatar', PNG, 'a.png')
        .expect(401);
    });
  });

  describe('two-factor authentication', () => {
    it('is set up with a first code, then asks for a code or a recovery code at sign-in', async () => {
      const carol = await account();
      const auth = { type: 'bearer' } as const;
      await http()
        .get('/v1/auth/security')
        .auth(carol.token, auth)
        .expect(200, {
          hasPassword: true,
          twoFactorEnabled: false,
          recoveryCodesLeft: null,
        });
      const setup = await http()
        .post('/v1/auth/2fa/setup')
        .auth(carol.token, auth)
        .expect(200);
      expect(setup.body.otpauthUrl).toContain(`42%20Chess:${carol.username}`);
      expect(setup.body.qrSvg).toMatch(/^<svg/);
      const secret = setup.body.secret as string;
      await http()
        .post('/v1/auth/2fa/enable')
        .auth(carol.token, auth)
        .send({ code: '000000' })
        .expect(401);
      const enabled = await http()
        .post('/v1/auth/2fa/enable')
        .auth(carol.token, auth)
        .send({ code: await generate({ secret }) })
        .expect(200);
      const codes = enabled.body.recoveryCodes as string[];
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect(mail.last('two-factor-enabled', carol.email)).toBeDefined();
      await http()
        .post('/v1/auth/2fa/setup')
        .auth(carol.token, auth)
        .expect(409);

      const login = await http()
        .post('/v1/auth/login')
        .send({ login: carol.username, password: PASSWORD })
        .expect(200);
      expect(login.body.requires2fa).toBe(true);
      const verified = await http()
        .post('/v1/auth/2fa/verify')
        .send({
          challengeToken: login.body.challengeToken,
          code: codes[0].toUpperCase(),
        })
        .expect(200);
      expect(verified.body.accessToken).toEqual(expect.any(String));
      // A recovery code works once.
      const again = await http()
        .post('/v1/auth/login')
        .send({ login: carol.username, password: PASSWORD })
        .expect(200);
      await http()
        .post('/v1/auth/2fa/verify')
        .send({ challengeToken: again.body.challengeToken, code: codes[0] })
        .expect(401);
      await http()
        .get('/v1/auth/security')
        .auth(carol.token, auth)
        .expect(200, {
          hasPassword: true,
          twoFactorEnabled: true,
          recoveryCodesLeft: 9,
        });

      const renewed = await http()
        .post('/v1/auth/2fa/recovery-codes')
        .auth(carol.token, auth)
        .send({ code: codes[1].replace('-', '') })
        .expect(200);
      expect(renewed.body.recoveryCodes).toHaveLength(10);
      await http()
        .post('/v1/auth/2fa/disable')
        .auth(carol.token, auth)
        .send({ code: codes[2] })
        .expect(401);
      await http()
        .post('/v1/auth/2fa/disable')
        .auth(carol.token, auth)
        .send({ code: renewed.body.recoveryCodes[0] })
        .expect(204);
      expect(mail.last('two-factor-disabled', carol.email)).toBeDefined();
      await http()
        .post('/v1/auth/login')
        .send({ login: carol.username, password: PASSWORD })
        .expect(200)
        .expect(({ body }) =>
          expect(body.accessToken).toEqual(expect.any(String)),
        );
    });
  });

  describe('passwords', () => {
    it('changes the password and signs out the other sessions only', async () => {
      const dave = await account();
      const other = await http()
        .post('/v1/auth/login')
        .send({ login: dave.username, password: PASSWORD })
        .expect(200);
      await http()
        .post('/v1/auth/password')
        .auth(dave.token, { type: 'bearer' })
        .send({
          currentPassword: 'wrong password',
          newPassword: 'another long one',
        })
        .expect(401);
      await http()
        .post('/v1/auth/password')
        .auth(dave.token, { type: 'bearer' })
        .send({ currentPassword: PASSWORD, newPassword: 'another long one' })
        .expect(204);
      await http()
        .get('/v1/users/me')
        .auth(dave.token, { type: 'bearer' })
        .expect(200);
      await http()
        .get('/v1/users/me')
        .auth(other.body.accessToken, { type: 'bearer' })
        .expect(401);
      expect(mail.last('password-changed', dave.email)).toBeDefined();
      await http()
        .post('/v1/auth/login')
        .send({ login: dave.username, password: 'another long one' })
        .expect(200);
    });

    it('answers a reset request the same way while the mail service is down', async () => {
      const gus = await account();
      mail.failNext = true;
      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: gus.email })
        .expect(202);
    });

    it('resets a forgotten password with a single-use emailed link', async () => {
      const erin = await account();
      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: 'nobody-here@example.com' })
        .expect(202);
      expect(
        mail.last('password-reset', 'nobody-here@example.com'),
      ).toBeUndefined();
      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: erin.email.toUpperCase() })
        .expect(202);
      const token = mail.last('password-reset', erin.email)!.token!;
      await http()
        .post('/v1/auth/reset-password')
        .send({ token, password: 'short' })
        .expect(400);
      await http()
        .post('/v1/auth/reset-password')
        .send({ token, password: 'a brand new password' })
        .expect(204);
      await http()
        .post('/v1/auth/reset-password')
        .send({ token, password: 'yet another password' })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_RESET_TOKEN'));
      // Every session was signed out.
      await http()
        .get('/v1/users/me')
        .auth(erin.token, { type: 'bearer' })
        .expect(401);
      await http()
        .post('/v1/auth/login')
        .send({ login: erin.username, password: PASSWORD })
        .expect(401);
      await http()
        .post('/v1/auth/login')
        .send({ login: erin.username, password: 'a brand new password' })
        .expect(200);
    });
  });

  describe('your data', () => {
    it('exports a readable copy of the account', async () => {
      const fay = await account();
      const exported = await http()
        .get('/v1/users/me/export')
        .auth(fay.token, { type: 'bearer' })
        .expect(200);
      expect(exported.headers['content-disposition']).toContain(
        `attachment; filename="42chess-${fay.username}-`,
      );
      expect(exported.text).toContain(
        '\n  "format": "42chess-account-export/1"',
      );
      const data = JSON.parse(exported.text);
      expect(data.account).toMatchObject({
        id: fay.id,
        username: fay.username,
        email: fay.email,
        signIn: { password: true, providers: [] },
      });
      expect(JSON.stringify(data)).not.toMatch(
        /passwordHash|argon2|refreshTokenHash/,
      );
      for (const key of [
        'games',
        'friends',
        'privateMessages',
        'gameChatMessages',
        'ratingHistory',
        'blockedPlayers',
      ])
        expect(data[key]).toEqual([]);
      expect(data.progression).toEqual({
        xp: 0,
        puzzleStreak: 0,
        bestPuzzleStreak: 0,
        lastStreakDate: null,
        experience: [],
        achievements: [],
      });
      expect(mail.last('data-exported', fay.email)).toBeDefined();

      // Friends on either side of the stored pair, and blocked players.
      const [first, second, blocked] = await Promise.all([
        account(),
        account(),
        account(),
      ]);
      for (const other of [first, second])
        await database.query(
          `INSERT INTO friendships ("userId", "friendId") VALUES ($1, $2)`,
          [fay.id, other.id].sort(),
        );
      await http()
        .put(`/v1/blocks/${blocked.id}`)
        .auth(fay.token, { type: 'bearer' })
        .expect(204);
      const again = JSON.parse(
        (
          await http()
            .get('/v1/users/me/export')
            .auth(fay.token, { type: 'bearer' })
            .expect(200)
        ).text,
      );
      expect(
        again.friends.map((row: { username: string }) => row.username).sort(),
      ).toEqual([first.username, second.username].sort());
      expect(again.blockedPlayers).toEqual([
        { username: blocked.username, since: expect.any(String) },
      ]);

      // Experience and achievements.
      await database.query(
        `INSERT INTO xp_events ("userId", source, "refId", amount) VALUES ($1, 'ACHIEVEMENT', 'FIRST_GAME', 10)`,
        [fay.id],
      );
      await database.query(
        `INSERT INTO user_progress ("userId", xp) VALUES ($1, 10)`,
        [fay.id],
      );
      await database.query(
        `INSERT INTO user_achievements ("userId", code) VALUES ($1, 'FIRST_GAME')`,
        [fay.id],
      );
      const third = JSON.parse(
        (
          await http()
            .get('/v1/users/me/export')
            .auth(fay.token, { type: 'bearer' })
            .expect(200)
        ).text,
      );
      expect(third.progression).toMatchObject({
        xp: 10,
        experience: [
          {
            source: 'ACHIEVEMENT',
            refId: 'FIRST_GAME',
            amount: 10,
            createdAt: expect.any(String),
          },
        ],
        achievements: [{ code: 'FIRST_GAME', unlockedAt: expect.any(String) }],
      });
    });

    it('deletes an account after confirmation and anonymizes what other players keep', async () => {
      const gus = await account();
      const friend = await account();
      // A friendship is stored once, smaller id first.
      await database.query(
        `INSERT INTO friendships ("userId", "friendId") VALUES ($1, $2)`,
        [gus.id, friend.id].sort(),
      );
      await database.query(
        `INSERT INTO messages ("senderId", "recipientId", content) VALUES ($1, $2, 'hello')`,
        [gus.id, friend.id],
      );
      await database.query(
        `INSERT INTO user_blocks ("blockerId", "blockedId") VALUES ($1, $2), ($2, $1)`,
        [gus.id, friend.id],
      );
      await database.query(
        `INSERT INTO user_progress ("userId", xp) VALUES ($1, 30)`,
        [gus.id],
      );
      await database.query(
        `INSERT INTO xp_events ("userId", source, "refId", amount) VALUES ($1, 'GAME', 'some-game', 30)`,
        [gus.id],
      );
      await database.query(
        `INSERT INTO user_achievements ("userId", code) VALUES ($1, 'FIRST_WIN')`,
        [gus.id],
      );
      const remove = (body: Record<string, unknown>) =>
        http()
          .delete('/v1/users/me')
          .auth(gus.token, { type: 'bearer' })
          .send(body);
      await remove({ confirmation: 'someone', password: PASSWORD })
        .expect(400)
        .expect(({ body }) =>
          expect(body.code).toBe('DELETE_CONFIRMATION_MISMATCH'),
        );
      await remove({
        confirmation: gus.username,
        password: 'wrong password',
      }).expect(401);
      await remove({ confirmation: gus.username }).expect(401);
      await remove({ confirmation: gus.username, password: PASSWORD }).expect(
        204,
      );

      const [row] = await database.query(
        `SELECT username, email, "passwordHash", "deletedAt" FROM users WHERE id = $1`,
        [gus.id],
      );
      expect(row.username).toMatch(/^deleted_[0-9a-f]{16}$/);
      expect(row.email).toBeNull();
      expect(row.passwordHash).toBeNull();
      expect(row.deletedAt).not.toBeNull();
      const [{ count }] = await database.query(
        `SELECT (SELECT count(*) FROM friendships WHERE "userId" = $1 OR "friendId" = $1)
              + (SELECT count(*) FROM messages WHERE "senderId" = $1 OR "recipientId" = $1)
              + (SELECT count(*) FROM user_blocks WHERE "blockerId" = $1 OR "blockedId" = $1)
              + (SELECT count(*) FROM user_progress WHERE "userId" = $1)
              + (SELECT count(*) FROM xp_events WHERE "userId" = $1)
              + (SELECT count(*) FROM user_achievements WHERE "userId" = $1) AS count`,
        [gus.id],
      );
      expect(Number(count)).toBe(0);
      expect(mail.last('account-deleted', gus.email)).toBeDefined();
      await http()
        .get('/v1/users/me')
        .auth(gus.token, { type: 'bearer' })
        .expect(401);
      await http()
        .post('/v1/auth/login')
        .send({ login: gus.username, password: PASSWORD })
        .expect(401);
      await http().get(`/v1/users/${gus.id}`).expect(404);
      // The name is free again.
      await http()
        .post('/v1/auth/register')
        .send({
          username: gus.username,
          email: `again_${gus.email}`,
          password: PASSWORD,
        })
        .expect(201);
    });

    it('keeps an account in a running game until the game ends', async () => {
      const hal = await account();
      const opponent = await account();
      const [game] = await database.query(
        `INSERT INTO games (status, "initialTime", increment, "startedAt") VALUES ('ACTIVE', 600000, 0, now()) RETURNING id`,
      );
      await database.query(
        `INSERT INTO game_players ("gameId", "userId", color) VALUES ($1, $2, 'WHITE'), ($1, $3, 'BLACK')`,
        [game.id, hal.id, opponent.id],
      );
      await http()
        .delete('/v1/users/me')
        .auth(hal.token, { type: 'bearer' })
        .send({ confirmation: hal.username, password: PASSWORD })
        .expect(409)
        .expect(({ body }) => expect(body.code).toBe('ACTIVE_GAME_EXISTS'));
      await database.query(`DELETE FROM game_players WHERE "gameId" = $1`, [
        game.id,
      ]);
      await database.query(`DELETE FROM games WHERE id = $1`, [game.id]);
    });
  });

  it('keeps unverified accounts out of search and public profiles', async () => {
    const name = `ghost_${randomUUID().slice(0, 8)}`;
    const ghost = await database
      .getRepository(User)
      .save(
        database
          .getRepository(User)
          .create({ username: name, email: `${name}@example.com` }),
      );
    await http().get(`/v1/users/${ghost.id}`).expect(404);
    const search = await http()
      .get('/v1/users/search')
      .query({ q: name })
      .expect(200);
    expect(search.body.users).toEqual([]);
    await database.getRepository(User).delete(ghost.id);
  });
});
