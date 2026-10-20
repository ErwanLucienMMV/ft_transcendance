import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { WebSocket } from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { PresenceService } from '../dist/presence/presence.service.js';
import { PresenceGateway } from '../dist/presence/presence.gateway.js';

describe('SCRUM-240 and SCRUM-243 connection cleanup', () => {
  let app: INestApplication,
    source: DataSource,
    presence: PresenceService,
    gateway: PresenceGateway,
    user: User,
    url: string;
  const clients: WebSocket[] = [];
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    gateway = app.get(PresenceGateway);
    user = await source
      .getRepository(User)
      .save({
        username: `disconnect_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      });
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const client of clients.splice(0)) client.terminate();
    await vi.waitFor(() => expect(presence.isOnline(user.id)).toBe(false));
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  async function open(autoPong = true) {
    const client = new WebSocket(url, { autoPong });
    clients.push(client);
    await once(client, 'open');
    return client;
  }
  async function authenticate(client: WebSocket, expiresIn = 120) {
    const token = await new JwtService().signAsync(
      { sub: user.id },
      { secret: process.env.JWT_SECRET, expiresIn },
    );
    const message = once(client, 'message');
    client.send(
      JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: token } }),
    );
    expect(JSON.parse(String((await message)[0])).event).toBe('AUTHENTICATED');
  }
  it('keeps another tab online when one closes, then clears the final connection', async () => {
    const first = await open(),
      second = await open();
    await authenticate(first);
    await authenticate(second);
    const firstClosed = once(first, 'close');
    first.close();
    await firstClosed;
    expect(presence.get(user.id).status).toBe('ONLINE');
    const secondClosed = once(second, 'close');
    second.close();
    await secondClosed;
    await vi.waitFor(() =>
      expect(presence.get(user.id).status).toBe('OFFLINE'),
    );
  });
  it('handles abrupt TCP termination without a close frame', async () => {
    const client = await open();
    await authenticate(client);
    const closed = once(client, 'close');
    client.terminate();
    await closed;
    await vi.waitFor(() =>
      expect(presence.get(user.id).status).toBe('OFFLINE'),
    );
  });
  it('does not resurrect a connection if the account lookup finishes after disconnection', async () => {
    const client = await open();
    let finish!: (user: User) => void;
    const lookup = vi
      .spyOn(source.getRepository(User), 'findOneBy')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const token = await new JwtService().signAsync(
      { sub: user.id },
      { secret: process.env.JWT_SECRET, expiresIn: 120 },
    );
    client.send(
      JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: token } }),
    );
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
    const closed = once(client, 'close');
    client.terminate();
    await closed;
    finish(user);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(presence.get(user.id).status).toBe('OFFLINE');
  });
  it('expires authenticated sessions when their signed access token expires', async () => {
    const client = await open();
    await authenticate(client, 2);
    const closed = once(client, 'close');
    expect((await closed)[0]).toBe(4401);
    expect(presence.get(user.id).status).toBe('OFFLINE');
  });
  it('removes a peer that does not answer WebSocket heartbeats', async () => {
    const client = await open(false);
    await authenticate(client);
    const ping = once(client, 'ping');
    gateway.checkConnections();
    await ping;
    const closed = once(client, 'close');
    gateway.checkConnections();
    await closed;
    expect(presence.get(user.id).status).toBe('OFFLINE');
  });
});
