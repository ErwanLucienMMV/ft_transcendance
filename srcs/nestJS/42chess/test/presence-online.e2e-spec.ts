import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { WebSocket } from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { PresenceService } from '../dist/presence/presence.service.js';

describe('SCRUM-241 ONLINE across WebSocket and public profiles', () => {
  let app: INestApplication<App>,
    source: DataSource,
    presence: PresenceService,
    user: User,
    unverified: User,
    url: string;
  const clients: WebSocket[] = [];
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    [user, unverified] = await source
      .getRepository(User)
      .save([
        {
          username: `online_${randomUUID().slice(0, 8)}`,
          emailVerifiedAt: new Date(),
        },
        { username: `unverified_${randomUUID().slice(0, 8)}` },
      ]);
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    await vi.waitFor(() => expect(presence.isOnline(user.id)).toBe(false));
  });
  afterAll(async () => {
    for (const account of [user, unverified])
      if (account) await source.getRepository(User).delete(account.id);
    await app?.close();
  });
  async function authenticate(account = user) {
    const client = new WebSocket(url);
    clients.push(client);
    await once(client, 'open');
    const accessToken = await new JwtService().signAsync(
      { sub: account.id },
      { secret: process.env.JWT_SECRET, expiresIn: 120 },
    );
    const message = once(client, account === unverified ? 'close' : 'message');
    client.send(
      JSON.stringify({
        event: 'AUTHENTICATE',
        data: { accessToken, userId: unverified.id },
      }),
    );
    return { client, result: await message };
  }
  const profile = async (id: string) =>
    (await request(app.getHttpServer()).get(`/v1/users/${id}`).expect(200))
      .body;
  it('exposes ONLINE only for the server-verified account', async () => {
    expect((await profile(user.id)).online).toBe(false);
    const { result } = await authenticate();
    expect(JSON.parse(String(result[0]))).toEqual({
      event: 'AUTHENTICATED',
      data: { userId: user.id },
    });
    expect(presence.get(user.id).status).toBe('ONLINE');
    expect((await profile(user.id)).online).toBe(true);
    expect((await profile(unverified.id)).online).toBe(false);
  });
  it('keeps the public profile online until the final authenticated tab closes', async () => {
    const first = await authenticate(),
      second = await authenticate();
    const closed = once(first.client, 'close');
    first.client.close();
    await closed;
    expect((await profile(user.id)).online).toBe(true);
    const lastClosed = once(second.client, 'close');
    second.client.close();
    await lastClosed;
    await vi.waitFor(async () =>
      expect((await profile(user.id)).online).toBe(false),
    );
  });
  it('rejects unverified accounts without creating ONLINE presence', async () => {
    const { result } = await authenticate(unverified);
    expect(result[0]).toBe(4401);
    expect(presence.get(unverified.id).status).toBe('OFFLINE');
    expect((await profile(unverified.id)).online).toBe(false);
  });
});
