import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import WebSocket from 'ws';
import { RealtimeGateway } from './realtime.gateway.js';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  RealtimeAuthenticator,
  UnavailableRealtimeAuthenticator,
} from './realtime-authenticator.js';
import { RealtimeMessages, parseRealtimeMessage } from './realtime-messages.js';

describe('Realtime gateway over actual sockets', () => {
  let http: ReturnType<typeof createServer>;
  let gateway: RealtimeGateway;
  let url: string;
  let clients: WebSocket[];
  let auth: RealtimeAuthenticator;
  let messages: RealtimeMessages;
  let metrics: MetricsService;
  beforeEach(async () => {
    metrics = new MetricsService();
    metrics.registry.clear();
    http = createServer();
    clients = [];
    auth = {
      authenticate: vi.fn(async () => ({
        userId: 'verified-player',
        expiresAt: Date.now() + 60000,
      })),
    };
    messages = {
      handle: vi.fn(async (client, message) =>
        client.send('ACK', message.data),
      ),
      disconnect: vi.fn(),
    };
    gateway = new RealtimeGateway(
      {
        httpAdapter: { getHttpServer: () => http },
      } as unknown as HttpAdapterHost,
      auth,
      messages,
      new ConfigService(),
      metrics,
    );
    gateway.onApplicationBootstrap();
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws`;
  });
  afterEach(async () => {
    for (const client of clients) client.terminate();
    gateway.onApplicationShutdown();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    metrics.registry.clear();
  });
  async function open() {
    const socket = new WebSocket(url);
    clients.push(socket);
    await once(socket, 'open');
    return socket;
  }
  async function request(socket: WebSocket, event: string, data: unknown) {
    const reply = once(socket, 'message');
    socket.send(JSON.stringify({ event, data }));
    const [raw] = await reply;
    return JSON.parse(raw.toString());
  }
  async function expectConnections(
    active: number,
    opened: number,
    closed: number,
  ) {
    await vi.waitFor(async () => {
      const output = await metrics.registry.metrics();
      expect(output).toContain(`\nwebsocket_connections_active ${active}\n`);
      expect(output).toContain(
        `\nwebsocket_connections_opened_total ${opened}\n`,
      );
      expect(output).toContain(
        `\nwebsocket_connections_closed_total ${closed}\n`,
      );
      expect(output).not.toContain('verified-player');
    });
  }
  it('tracks concurrent accepted sockets before authentication and balanced closes', async () => {
    await expectConnections(0, 0, 0);
    const first = await open();
    const second = await open();
    await expectConnections(2, 2, 0);
    await request(first, 'AUTHENTICATE', { accessToken: 'test-token' });
    await expectConnections(2, 2, 0);

    const firstClosed = once(first, 'close');
    first.close(1000, 'Done');
    await firstClosed;
    await expectConnections(1, 2, 1);

    const secondClosed = once(second, 'close');
    second.terminate();
    await secondClosed;
    await expectConnections(0, 2, 2);
  });
  it('counts failed authentication as an opened and closed connection', async () => {
    vi.spyOn(auth, 'authenticate').mockRejectedValue(
      new Error('Token rejected'),
    );
    const socket = await open();
    const closed = once(socket, 'close');
    await expectConnections(1, 1, 0);
    await request(socket, 'AUTHENTICATE', { accessToken: 'invalid-token' });
    await closed;
    await expectConnections(0, 1, 1);
  });
  it('balances active connections when shutdown terminates sockets', async () => {
    const first = await open();
    const second = await open();
    await request(first, 'AUTHENTICATE', { accessToken: 'valid-token' });
    const closed = Promise.all([once(first, 'close'), once(second, 'close')]);
    gateway.onApplicationShutdown();
    await closed;
    await expectConnections(0, 2, 2);
    // Shutdown may be called again by the application without double counting.
    gateway.onApplicationShutdown();
    await expectConnections(0, 2, 2);
  });
  it('passes only verified identity to message handlers and cleans disconnects', async () => {
    const socket = await open();
    expect(
      await request(socket, 'AUTHENTICATE', { accessToken: 'test-token' }),
    ).toEqual({ event: 'AUTHENTICATED', data: { userId: 'verified-player' } });
    expect(auth.authenticate).toHaveBeenCalledWith('test-token');
    expect(await request(socket, 'JOIN_GAME', { gameId: 'game' })).toEqual({
      event: 'ACK',
      data: { gameId: 'game' },
    });
    expect(messages.handle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'verified-player' }),
      expect.anything(),
    );
    const closed = once(socket, 'close');
    socket.close();
    await closed;
    await vi.waitFor(() => expect(messages.disconnect).toHaveBeenCalledOnce());
  });
  it('refuses private events before authentication and closes the connection', async () => {
    const socket = await open();
    const closed = once(socket, 'close');
    expect(
      await request(socket, 'JOIN_GAME', { gameId: 'game', userId: 'spoofed' }),
    ).toMatchObject({
      event: 'ERROR',
      data: { statusCode: 401, code: 'AUTH_REQUIRED' },
    });
    expect((await closed)[0]).toBe(4401);
    expect(messages.handle).not.toHaveBeenCalled();
  });
  it('fails closed when authentication is unavailable', async () => {
    vi.spyOn(auth, 'authenticate').mockImplementation((token) =>
      new UnavailableRealtimeAuthenticator().authenticate(token),
    );
    const socket = await open();
    const closed = once(socket, 'close');
    expect(
      await request(socket, 'AUTHENTICATE', { accessToken: 'anything' }),
    ).toMatchObject({ event: 'ERROR', data: { code: 'AUTH_UNAVAILABLE' } });
    expect((await closed)[0]).toBe(4401);
    expect(messages.handle).not.toHaveBeenCalled();
  });
  it('revalidates an authenticated session before accepting a private command', async () => {
    vi.spyOn(auth, 'authenticate').mockResolvedValue({
      userId: 'verified-player',
      expiresAt: Date.now() + 60000,
      validate: async () => {
        throw new UnauthorizedException('Revoked session');
      },
    });
    const socket = await open();
    expect(
      await request(socket, 'AUTHENTICATE', { accessToken: 'test-token' }),
    ).toMatchObject({ event: 'AUTHENTICATED' });
    const closed = once(socket, 'close');
    expect(
      await request(socket, 'JOIN_GAME', { gameId: 'game' }),
    ).toMatchObject({ event: 'ERROR', data: { statusCode: 401 } });
    expect((await closed)[0]).toBe(4401);
    expect(messages.handle).not.toHaveBeenCalled();
  });
  it('does not authenticate a claimed userId or accept extra authentication keys', async () => {
    const socket = await open();
    expect(
      await request(socket, 'AUTHENTICATE', {
        accessToken: 'token',
        userId: 'spoof',
      }),
    ).toMatchObject({ event: 'ERROR', data: { statusCode: 401 } });
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
  it('rejects an expired verified principal', async () => {
    vi.spyOn(auth, 'authenticate').mockResolvedValue({
      userId: 'verified-player',
      expiresAt: Date.now() - 1,
    });
    const socket = await open();
    expect(
      await request(socket, 'AUTHENTICATE', { accessToken: 'expired' }),
    ).toMatchObject({ event: 'ERROR', data: { statusCode: 401 } });
  });
  it('closes authenticated sockets at verified expiry', async () => {
    vi.spyOn(auth, 'authenticate').mockResolvedValue({
      userId: 'verified-player',
      expiresAt: Date.now() + 150,
    });
    const socket = await open();
    const closed = once(socket, 'close');
    await request(socket, 'AUTHENTICATE', { accessToken: 'short' });
    expect((await closed)[0]).toBe(4401);
  });
  it('rejects invalid JSON without leaking input', async () => {
    const socket = await open();
    const reply = once(socket, 'message');
    socket.send('not JSON secret-token');
    const [raw] = await reply;
    expect(JSON.parse(raw.toString())).toMatchObject({
      event: 'ERROR',
      data: { statusCode: 400 },
    });
    expect(raw.toString()).not.toContain('secret-token');
  });
  it('bounds frame size before JSON parsing', async () => {
    const socket = await open();
    const closed = once(socket, 'close');
    socket.send('x'.repeat(16385));
    expect((await closed)[0]).toBe(1009);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
  it('rejects binary messages', async () => {
    const socket = await open();
    const closed = once(socket, 'close');
    socket.send(Buffer.from('binary'));
    expect((await closed)[0]).toBe(1003);
  });
  it('bounds a complete fragmented message before authentication or dispatch', async () => {
    const socket = await open();
    const closed = once(socket, 'close');
    socket.send('x'.repeat(9000), { fin: false });
    socket.send('x'.repeat(9000), { fin: true });
    expect((await closed)[0]).toBe(1009);
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(messages.handle).not.toHaveBeenCalled();
  });
  it('measures the payload bound in UTF-8 bytes', async () => {
    const socket = await open();
    const closed = once(socket, 'close');
    // 10,000 UTF-16 code units but 20,000 wire bytes.
    socket.send('💡'.repeat(5000));
    expect((await closed)[0]).toBe(1009);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
  it('enforces the rate budget even when commands finish between sends', async () => {
    const socket = await open();
    await request(socket, 'AUTHENTICATE', { accessToken: 'valid' });
    for (let i = 0; i < 59; i++)
      expect(await request(socket, 'JOIN_GAME', {})).toMatchObject({
        event: 'ACK',
      });
    const closed = once(socket, 'close');
    expect(await request(socket, 'JOIN_GAME', {})).toMatchObject({
      event: 'ERROR',
      data: { statusCode: 429, code: 'TOO_MANY_REQUESTS' },
    });
    expect((await closed)[0]).toBe(1013);
    expect(messages.handle).toHaveBeenCalledTimes(59);
    const healthy = await open();
    expect(
      await request(healthy, 'AUTHENTICATE', { accessToken: 'valid' }),
    ).toMatchObject({ event: 'AUTHENTICATED' });
    expect(await request(healthy, 'JOIN_GAME', {})).toMatchObject({
      event: 'ACK',
    });
  });
  it('renews the message budget after the ten-second window', async () => {
    const socket = await open();
    await request(socket, 'AUTHENTICATE', { accessToken: 'valid' });
    for (let i = 0; i < 59; i++) await request(socket, 'JOIN_GAME', {});
    // Advance only the gateway's wall clock, preserving real socket IO and
    // timers. The verified principal remains within its one-minute lifetime.
    const nextWindow = Date.now() + 10_001;
    const now = vi.spyOn(Date, 'now').mockReturnValue(nextWindow);
    try {
      expect(await request(socket, 'JOIN_GAME', {})).toMatchObject({
        event: 'ACK',
      });
      expect(await request(socket, 'JOIN_GAME', {})).toMatchObject({
        event: 'ACK',
      });
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      now.mockRestore();
    }
  });
  it('bounds queued work while validation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(auth, 'authenticate').mockResolvedValue({
      userId: 'verified-player',
      expiresAt: Date.now() + 60000,
      validate: () => pending,
    });
    const socket = await open();
    await request(socket, 'AUTHENTICATE', { accessToken: 'valid' });
    try {
      const closed = once(socket, 'close');
      for (let i = 0; i < 33; i++)
        socket.send(JSON.stringify({ event: 'JOIN_GAME', data: {} }));
      expect((await closed)[0]).toBe(1013);
      expect(messages.handle).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it('bounds messages per connection', async () => {
    const socket = await open();
    await request(socket, 'AUTHENTICATE', { accessToken: 'valid' });
    const closed = once(socket, 'close');
    for (let i = 0; i < 65; i++)
      socket.send(JSON.stringify({ event: 'JOIN_GAME', data: {} }));
    expect((await closed)[0]).toBe(1013);
  });
  it('rejects browser upgrades from a foreign origin', async () => {
    const socket = new WebSocket(url, { origin: 'https://foreign.example' });
    clients.push(socket);
    const failure = new Promise<Error>((resolve) =>
      socket.once('error', resolve),
    );
    expect((await failure).message).toContain('403');
    expect(auth.authenticate).not.toHaveBeenCalled();
    await expectConnections(0, 0, 0);
  });
});

describe('Realtime envelope', () => {
  it.each([
    'null',
    '[]',
    '{"event":"JOIN_GAME","data":[]}',
    '{"event":"JOIN_GAME","data":{},"userId":"spoof"}',
    '{"event":"lowercase","data":{}}',
  ])('rejects malformed envelopes: %s', (value) =>
    expect(() => parseRealtimeMessage(value)).toThrow(),
  );
});
