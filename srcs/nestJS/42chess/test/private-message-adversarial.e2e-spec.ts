import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';

interface Packet {
  event: string;
  data: Record<string, unknown>;
}

describe('SCRUM-252/254/256 adversarial public messaging boundary', () => {
  let app: INestApplication, source: DataSource, alice: User, bob: User;
  let token: string, url: string;
  const clients: WebSocket[] = [];
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    const suffix = randomUUID().slice(0, 8);
    [alice, bob] = await source.getRepository(User).save(
      ['alice', 'bob'].map((name) => ({
        username: `pma_${name}_${suffix}`,
        emailVerifiedAt: new Date(),
      })),
    );
    token = (await app.get(SessionService).issue(alice)).accessToken;
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });
  afterEach(async () => {
    await Promise.all(
      clients.splice(0).map(async (socket) => {
        if (socket.readyState === WebSocket.CLOSED) return;
        const closed = once(socket, 'close');
        socket.terminate();
        await closed;
      }),
    );
    if (alice)
      await source.query('DELETE FROM messages WHERE "senderId" = $1', [
        alice.id,
      ]);
  });
  afterAll(async () => {
    if (source?.isInitialized && alice)
      await source.getRepository(User).delete([alice.id, bob.id]);
    await app?.close();
  });
  async function open() {
    const socket = new WebSocket(url);
    clients.push(socket);
    const packets: Packet[] = [];
    socket.on('message', (raw) => {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : raw;
      packets.push(JSON.parse(bytes.toString('utf8')) as Packet);
    });
    await once(socket, 'open');
    const take = async () => {
      await vi.waitFor(() => expect(packets.length).toBeGreaterThan(0), {
        timeout: 2000,
        interval: 10,
      });
      return packets.shift()!;
    };
    const send = (data: unknown) =>
      socket.send(JSON.stringify({ event: 'SEND_PRIVATE_MESSAGE', data }));
    socket.send(
      JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: token } }),
    );
    expect(await take()).toEqual({
      event: 'AUTHENTICATED',
      data: { userId: alice.id },
    });
    return { socket, packets, take, send };
  }
  const history = () =>
    request(app.getHttpServer())
      .get(`/v1/conversations/${bob.id}/messages`)
      .auth(token, { type: 'bearer' });

  it.each(['\ud800', '\udc00', 'hello\ud800world'])(
    'rejects malformed Unicode %j over WebSocket without acknowledging or persisting it',
    async (content) => {
      const client = await open();
      client.send({ receiverId: bob.id, content });
      expect(await client.take()).toMatchObject({
        event: 'ERROR',
        data: { statusCode: 400 },
      });
      expect((await history().expect(200)).body.total).toBe(0);
    },
  );

  it('round-trips the largest escaped control-character payload without losing data', async () => {
    const client = await open();
    const content = '\u0001'.repeat(2000);
    client.send({ receiverId: bob.id, content });
    const packet = await client.take();
    expect(packet).toMatchObject({
      event: 'PRIVATE_MESSAGE',
      data: { senderId: alice.id, receiverId: bob.id, content },
    });
    expect((await history().expect(200)).body.messages).toEqual([packet.data]);
  });

  it('never acknowledges content different from the authoritative HTTP history', async () => {
    const client = await open();
    client.send({ receiverId: bob.id, content: 'before\ud800after' });
    const packet = await client.take();
    const response = await history().expect(200);
    if (packet.event === 'ERROR') {
      expect(packet.data.statusCode).toBe(400);
      expect(response.body.total).toBe(0);
      return;
    }
    expect(packet.event).toBe('PRIVATE_MESSAGE');
    // Escaping makes U+D800 versus U+FFFD visible in terminal failure output.
    expect(JSON.stringify(response.body.messages[0].content)).toBe(
      JSON.stringify(packet.data.content),
    );
    expect(response.body.messages).toEqual([packet.data]);
  });

  it('rejects malformed payload types and remains usable for a subsequent send', async () => {
    const client = await open();
    for (const data of [
      null,
      [],
      'text',
      true,
      { receiverId: bob.id, content: {} },
      { receiverId: bob.id, content: [] },
      { receiverId: bob.id, content: 123 },
      { receiverId: bob.id, content: true },
    ]) {
      client.send(data);
      expect(await client.take()).toMatchObject({
        event: 'ERROR',
        data: { statusCode: 400 },
      });
    }
    expect((await history().expect(200)).body.total).toBe(0);
    client.send({ receiverId: bob.id, content: 'still usable' });
    const saved = await client.take();
    expect(saved.event).toBe('PRIVATE_MESSAGE');
    expect((await history().expect(200)).body.messages).toEqual([saved.data]);
  });

  it.each([
    'limit=Infinity',
    'offset=Infinity',
    'offset=9007199254740992',
    'limit=1&limit=2',
    'offset=0&offset=1',
    'limit[]=1',
    'offset[$gt]=0',
    'senderId=forged',
  ])('rejects unsafe or ambiguous history query %s', async (query) => {
    await request(app.getHttpServer())
      .get(`/v1/conversations/${bob.id}/messages?${query}`)
      .auth(token, { type: 'bearer' })
      .expect(400);
  });

  it('accepts the documented safe-integer offset boundary and uppercase peer UUID', async () => {
    await request(app.getHttpServer())
      .get(
        `/v1/conversations/${bob.id.toUpperCase()}/messages?limit=100&offset=${Number.MAX_SAFE_INTEGER}`,
      )
      .auth(token, { type: 'bearer' })
      .expect(200, {
        messages: [],
        total: 0,
        limit: 100,
        offset: Number.MAX_SAFE_INTEGER,
      });
  });

  it('rejects an injection-shaped peer ID without exposing database details', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/conversations/${encodeURIComponent("' OR 1=1 --")}/messages`)
      .auth(token, { type: 'bearer' })
      .expect(400);
    expect(JSON.stringify(response.body)).not.toMatch(
      /SELECT|postgres|driverError|stack/,
    );
  });
});
