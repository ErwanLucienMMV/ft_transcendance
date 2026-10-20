import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { WebSocket } from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { GamesService } from '../dist/games/games.service.js';
import { PresenceService } from '../dist/presence/presence.service.js';
import { PresenceGateway } from '../dist/presence/presence.gateway.js';

interface Packet {
  event: string;
  data: { userId?: string; status?: string; lastSeen?: string };
}
describe('SCRUM-245 private friend presence events', () => {
  let app: INestApplication,
    source: DataSource,
    presence: PresenceService,
    gateway: PresenceGateway,
    url: string;
  let users: User[] = [],
    friendship: string;
  const clients: WebSocket[] = [],
    owned: string[] = [];
  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    gateway = app.get(PresenceGateway);
    users = await source.getRepository(User).save(
      ['alice', 'bob', 'outsider'].map((name) => ({
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
    for (const id of owned.splice(0)) {
      await source.query('DELETE FROM rating_history WHERE "gameId"=$1', [id]);
      await source.query('DELETE FROM games WHERE id=$1', [id]);
    }
  });
  afterAll(async () => {
    if (friendship)
      await source.query('DELETE FROM friendships WHERE id=$1', [friendship]);
    for (const user of users) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  async function connect(user: User) {
    const client = new WebSocket(url),
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
    expect(JSON.parse(String((await message)[0])).event).toBe('AUTHENTICATED');
    return { client, packets };
  }
  const events = (packets: Packet[], name: string) =>
    packets.filter(
      (packet) => packet.event === name && packet.data.userId === users[0].id,
    );
  it('sends USER_ONLINE only to authenticated friends with the committed account identity', async () => {
    const bob = await connect(users[1]),
      outsider = await connect(users[2]);
    await connect(users[0]);
    await gateway.flushNotifications();
    await vi.waitFor(() =>
      expect(events(bob.packets, 'USER_ONLINE')).toHaveLength(1),
    );
    expect(events(bob.packets, 'USER_ONLINE')[0].data).toMatchObject({
      userId: users[0].id,
      status: 'ONLINE',
    });
    expect(events(bob.packets, 'USER_ONLINE')[0].data.lastSeen).toMatch(/Z$/);
    expect(events(outsider.packets, 'USER_ONLINE')).toEqual([]);
  });
  it('does not send a duplicate USER_ONLINE when the same account opens another tab', async () => {
    const bob = await connect(users[1]);
    await connect(users[0]);
    await connect(users[0]);
    await gateway.flushNotifications();
    await vi.waitFor(() =>
      expect(events(bob.packets, 'USER_ONLINE')).toHaveLength(1),
    );
  });
  it('sends authoritative game-status changes to friends after commit', async () => {
    const bob = await connect(users[1]);
    await connect(users[0]);
    const games = app.get(GamesService);
    const { game } = await games.create(users[0].id, { initialTime: 300000 });
    owned.push(game.id);
    await games.join(users[2].id, game.id);
    await gateway.flushNotifications();
    await vi.waitFor(() =>
      expect(
        events(bob.packets, 'USER_STATUS_CHANGED').map(
          (packet) => packet.data.status,
        ),
      ).toEqual(['IN_GAME']),
    );
    await games.resign(users[2].id, game.id);
    await gateway.flushNotifications();
    await vi.waitFor(() =>
      expect(
        events(bob.packets, 'USER_STATUS_CHANGED').map(
          (packet) => packet.data.status,
        ),
      ).toEqual(['IN_GAME', 'ONLINE']),
    );
  });
});
