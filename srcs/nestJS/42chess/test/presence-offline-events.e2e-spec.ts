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

interface Packet {
  event: string;
  data: { userId?: string; status?: string; lastSeen?: string };
}
describe('SCRUM-246 final-disconnect events', () => {
  let app: INestApplication,
    source: DataSource,
    presence: PresenceService,
    gateway: PresenceGateway,
    url: string;
  let users: User[] = [],
    friendship: string;
  const clients: WebSocket[] = [];
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    gateway = app.get(PresenceGateway);
    users = await source
      .getRepository(User)
      .save(
        ['subject', 'friend', 'outsider'].map((name) => ({
          username: `${name}_${randomUUID().slice(0, 8)}`,
          emailVerifiedAt: new Date(),
        })),
      );
    const pair = [users[0].id, users[1].id].sort((a, b) => a.localeCompare(b));
    [{ id: friendship }] = await source.query(
      'INSERT INTO friendships ("userId", "friendId") VALUES ($1,$2) RETURNING id',
      pair,
    );
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    await vi.waitFor(() => {
      for (const user of users) expect(presence.isOnline(user.id)).toBe(false);
    });
    await gateway.flushNotifications();
    await presence.flushSeen();
  });
  afterAll(async () => {
    if (friendship)
      await source.query('DELETE FROM friendships WHERE id=$1', [friendship]);
    for (const user of users) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  async function connect(user: User, autoPong = true) {
    const client = new WebSocket(url, { autoPong }),
      packets: Packet[] = [];
    clients.push(client);
    client.on('message', (raw) => {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw);
      packets.push(JSON.parse(bytes.toString('utf8')) as Packet);
    });
    await once(client, 'open');
    const message = once(client, 'message');
    const accessToken = await new JwtService().signAsync(
      { sub: user.id },
      { secret: process.env.JWT_SECRET, expiresIn: 120 },
    );
    client.send(
      JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken } }),
    );
    await message;
    return { client, packets };
  }
  const offline = (packets: Packet[]) =>
    packets.filter(
      (packet) =>
        packet.event === 'USER_OFFLINE' && packet.data.userId === users[0].id,
    );
  it('sends one private USER_OFFLINE after the final tab closes, with persisted lastSeen', async () => {
    const friend = await connect(users[1]),
      outsider = await connect(users[2]);
    const first = await connect(users[0]),
      last = await connect(users[0]);
    await gateway.flushNotifications();
    const firstClosed = once(first.client, 'close');
    first.client.close();
    await firstClosed;
    await gateway.flushNotifications();
    expect(offline(friend.packets)).toEqual([]);
    const lastClosed = once(last.client, 'close');
    last.client.close();
    await lastClosed;
    await vi.waitFor(() => expect(offline(friend.packets)).toHaveLength(1));
    await presence.flushSeen();
    const stored = await source
      .getRepository(User)
      .findOneByOrFail({ id: users[0].id });
    expect(offline(friend.packets)[0].data).toEqual({
      userId: users[0].id,
      status: 'OFFLINE',
      lastSeen: stored.lastSeenAt!.toISOString(),
    });
    expect(offline(outsider.packets)).toEqual([]);
  });
  it('sends USER_OFFLINE when a dead peer misses its heartbeat', async () => {
    const subject = await connect(users[0], false);
    const ping = once(subject.client, 'ping');
    gateway.checkConnections();
    await ping;
    // A fresh observer has not missed the subject's previous heartbeat.
    const friend = await connect(users[1]);
    const closed = once(subject.client, 'close');
    gateway.checkConnections();
    await closed;
    await gateway.flushNotifications();
    await vi.waitFor(() => expect(offline(friend.packets)).toHaveLength(1));
    expect(offline(friend.packets)[0].data.status).toBe('OFFLINE');
  });
});
