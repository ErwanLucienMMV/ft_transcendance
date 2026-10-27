import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';

describe('Real JWT identity across HTTP and WebSocket (SCRUM-178/179/533)', () => {
  let app: INestApplication,
    source: DataSource,
    sessions: SessionService,
    user: User,
    url: string;
  const clients: WebSocket[] = [],
    games: string[] = [];
  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL = process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
    source = app.get(DataSource);
    sessions = app.get(SessionService);
    user = await source
      .getRepository(User)
      .save(
        source
          .getRepository(User)
          .create({
            username: `jwt_${randomUUID().slice(0, 8)}`,
            emailVerifiedAt: new Date(),
          }),
      );
  });
  afterAll(async () => {
    for (const client of clients) client.terminate();
    for (const id of games)
      await source.query('DELETE FROM games WHERE id = $1', [id]);
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  async function connect(token: string) {
    const socket = new WebSocket(url);
    clients.push(socket);
    await once(socket, 'open');
    const reply = once(socket, 'message');
    socket.send(
      JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: token } }),
    );
    return { socket, packet: JSON.parse((await reply)[0].toString()) };
  }
  it('uses the same server-verified actor in REST games and WS rooms', async () => {
    const { accessToken } = await sessions.issue(user);
    const response = await request(app.getHttpServer())
      .post('/v1/games')
      .auth(accessToken, { type: 'bearer' })
      .send({ timeControl: { initialTime: 300000, increment: 0 } })
      .expect(201);
    games.push(response.body.gameId);
    const { socket, packet } = await connect(accessToken);
    expect(packet).toEqual({
      event: 'AUTHENTICATED',
      data: { userId: user.id },
    });
    const state = once(socket, 'message');
    socket.send(
      JSON.stringify({
        event: 'JOIN_GAME',
        data: { gameId: response.body.gameId },
      }),
    );
    expect(JSON.parse((await state)[0].toString())).toMatchObject({
      event: 'GAME_STATE',
      data: { gameId: response.body.gameId },
    });
  });
  it('closes an idle authenticated connection after HTTP logout and refuses token reuse', async () => {
    const { accessToken } = await sessions.issue(user);
    const { socket, packet } = await connect(accessToken);
    expect(packet.event).toBe('AUTHENTICATED');
    const closed = once(socket, 'close');
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .auth(accessToken, { type: 'bearer' })
      .expect(204);
    expect((await closed)[0]).toBe(4401);
    const retry = await connect(accessToken);
    expect(retry.packet).toMatchObject({
      event: 'ERROR',
      data: { code: 'INVALID_TOKEN' },
    });
  });
  it('refuses forged tokens through the actual production authenticator', async () => {
    const result = await connect('untrusted-browser-test-token');
    expect(result.packet).toMatchObject({
      event: 'ERROR',
      data: { code: 'INVALID_TOKEN' },
    });
  });
});
