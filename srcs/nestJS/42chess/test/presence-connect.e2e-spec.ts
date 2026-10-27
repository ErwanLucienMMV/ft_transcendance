import { sessionToken } from './session.fixture.js';
import { once } from 'node:events';
import { randomUUID, createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { WebSocket } from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { PresenceService } from '../dist/presence/presence.service.js';

describe('SCRUM-239 authenticated native WebSocket connections', () => {
  let app: INestApplication,
    source: DataSource,
    presence: PresenceService,
    user: User,
    url: string;
  const clients: WebSocket[] = [];
  const jwt = new JwtService();
  const sign = async (sub: string, options = {}) => {
    const { iat: _iat, exp: _exp, ...claims } = jwt.decode<Record<string, unknown>>(
      await sessionToken(app, user.id),
    );
    return jwt.signAsync(
      { ...claims, sub },
      { secret: process.env.JWT_SECRET, expiresIn: 120, ...options },
    );
  };
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    user = await source.getRepository(User).save({
      username: `presence_${randomUUID().slice(0, 8)}`,
      emailVerifiedAt: new Date(),
    });
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    await vi.waitFor(() => expect(presence.isOnline(user.id)).toBe(false));
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  async function open() {
    const client = new WebSocket(url);
    clients.push(client);
    await once(client, 'open');
    return client;
  }
  it('binds presence to the verified token subject and returns the frontend handshake', async () => {
    const client = await open();
    expect(presence.isOnline(user.id)).toBe(false);
    const message = once(client, 'message');
    client.send(
      JSON.stringify({
        event: 'AUTHENTICATE',
        data: { accessToken: await sessionToken(app, user.id) },
      }),
    );
    expect(JSON.parse(String((await message)[0]))).toEqual({
      event: 'AUTHENTICATED',
      data: { userId: user.id },
    });
    expect(presence.get(user.id).status).toBe('ONLINE');
  });
  it('rejects an authentication payload with a forged identity field', async () => {
    const client = await open();
    const closed = once(client, 'close');
    client.send(
      JSON.stringify({
        event: 'AUTHENTICATE',
        data: {
          accessToken: await sessionToken(app, user.id),
          userId: randomUUID(),
        },
      }),
    );
    expect((await closed)[0]).toBe(4401);
    expect(presence.isOnline(user.id)).toBe(false);
  });
  it.each(['forged', 'expired', 'missing-user', 'challenge', 'no-expiry'])(
    'rejects %s tokens without creating presence',
    async (kind) => {
      const client = await open();
      let accessToken = await sign(user.id);
      if (kind === 'forged')
        accessToken = await sign(user.id, { secret: 'wrong' });
      if (kind === 'expired')
        accessToken = await sessionToken(app, user.id, -1);
      if (kind === 'missing-user') accessToken = await sign(randomUUID());
      if (kind === 'no-expiry')
        accessToken = await jwt.signAsync(
          (() => {
            const { exp: _exp, iat: _iat, ...claims } =
              jwt.decode<Record<string, unknown>>(accessToken);
            return claims;
          })(),
          { secret: process.env.JWT_SECRET },
        );
      if (kind === 'challenge')
        accessToken = await jwt.signAsync(
          { sub: user.id, typ: '2fa-challenge' },
          {
            secret: createHmac('sha256', process.env.JWT_SECRET!)
              .update('2fa-challenge')
              .digest('base64url'),
            expiresIn: 120,
          },
        );
      const closed = once(client, 'close');
      client.send(
        JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken } }),
      );
      expect((await closed)[0]).toBe(4401);
      expect(presence.isOnline(user.id)).toBe(false);
    },
  );
  it('rejects an event before authentication', async () => {
    const client = await open();
    const closed = once(client, 'close');
    client.send(
      JSON.stringify({ event: 'JOIN_GAME', data: { userId: user.id } }),
    );
    expect((await closed)[0]).toBe(4401);
  });
});
