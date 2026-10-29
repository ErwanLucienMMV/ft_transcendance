import {
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  UnauthorizedException,
} from '@nestjs/common';
import { MatchmakingEvents } from '../matchmaking/matchmaking-events.service.js';
import { PresenceGateway } from '../presence/presence.gateway.js';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { apiError } from '../common/api-error.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { RealtimeAuthenticator } from './realtime-authenticator.js';
import type { RealtimePrincipal } from './realtime-authenticator.js';
import { parseRealtimeMessage, RealtimeMessages } from './realtime-messages.js';

@Injectable()
export class RealtimeGateway
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private server?: WebSocketServer;
  private http?: Server;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly alive = new WeakSet<WebSocket>();

  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly auth: RealtimeAuthenticator,
    private readonly messages: RealtimeMessages,
    private readonly config: ConfigService,
    metrics: MetricsService,
    @Optional() private readonly presence?: PresenceGateway,
    @Optional() private readonly matchmaking?: MatchmakingEvents,
  ) {
    this.connectionsActive = metrics.gauge({
      name: 'websocket_connections_active',
      help: 'Accepted WebSocket connections currently open, including connections awaiting authentication.',
    });
    this.connectionsOpened = metrics.counter({
      name: 'websocket_connections_opened_total',
      help: 'Total accepted WebSocket connections, including connections awaiting authentication.',
    });
    this.connectionsClosed = metrics.counter({
      name: 'websocket_connections_closed_total',
      help: 'Total accepted WebSocket connections that closed, including authentication failures.',
    });
  }

  private readonly connectionsActive;
  private readonly connectionsOpened;
  private readonly connectionsClosed;

  onApplicationBootstrap(): void {
    this.http = this.adapter.httpAdapter.getHttpServer() as Server;
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: 16_384,
      perMessageDeflate: false,
    });
    this.server.on('connection', (socket) => this.connect(socket));
    this.http.on('upgrade', this.upgrade);
    this.heartbeat = setInterval(() => this.checkConnections(), 30_000);
    this.heartbeat.unref();
  }

  checkConnections(): void {
    for (const socket of this.server?.clients ?? []) {
      if (!this.alive.has(socket)) {
        socket.terminate();
        continue;
      }
      this.alive.delete(socket);
      socket.ping();
    }
  }

  onApplicationShutdown(): void {
    clearInterval(this.heartbeat);
    this.http?.off('upgrade', this.upgrade);
    for (const socket of this.server?.clients ?? []) socket.terminate();
    this.server?.close();
  }

  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    if (request.url !== '/ws' || !this.originAllowed(request)) {
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    this.server?.handleUpgrade(request, socket, head, (client) =>
      this.server?.emit('connection', client, request),
    );
  };

  private originAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return true; // Non-browser clients still require verified authentication.
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
        return false;
      if (url.host === request.headers.host) return true;
      return (this.config.get<string>('CORS_ORIGINS') ?? '')
        .split(',')
        .map((v) => v.trim())
        .includes(origin);
    } catch {
      return false;
    }
  }

  private connect(socket: WebSocket): void {
    this.connectionsActive.inc();
    this.connectionsOpened.inc();
    const connectionId = randomUUID();
    let principal: RealtimePrincipal | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let validation: ReturnType<typeof setInterval> | undefined;
    let validating = false;
    let queued = 0,
      count = 0,
      windowStart = Date.now();
    let queue = Promise.resolve();
    const authTimeout = setTimeout(() => {
      this.send(socket, 'ERROR', {
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
      socket.close(4401, 'Authentication required');
    }, 5000);
    authTimeout.unref();
    this.alive.add(socket);
    socket.on('pong', () => this.alive.add(socket));
    socket.on('error', () => this.logger.warn('Realtime connection failed.'));
    socket.once('close', () => {
      this.connectionsActive.dec();
      this.connectionsClosed.inc();
      clearTimeout(authTimeout);
      clearTimeout(expiry);
      clearInterval(validation);
      this.presence?.disconnect(connectionId);
      this.messages.disconnect(connectionId);
      this.matchmaking?.disconnect(connectionId);
    });
    socket.on('message', (raw, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - windowStart >= 10_000) {
        count = 0;
        windowStart = Date.now();
      }
      if (++count > 60 || queued >= 32) {
        this.send(socket, 'ERROR', {
          statusCode: 429,
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many realtime messages.',
        });
        socket.close(1013, 'Rate limit');
        return;
      }
      ++queued;
      queue = queue
        .then(async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          try {
            if (binary) {
              socket.close(1003, 'Text JSON messages required');
              return;
            }
            const message = parseRealtimeMessage(raw.toString());
            if (!principal) {
              if (message.event !== 'AUTHENTICATE')
                throw new UnauthorizedException(
                  'Authenticate before sending events.',
                );
              const token = message.data.accessToken;
              if (
                Object.keys(message.data).length !== 1 ||
                typeof token !== 'string' ||
                !token ||
                token.length > 8192
              ) {
                throw new UnauthorizedException(
                  'Invalid authentication message.',
                );
              }
              const verified = await this.auth.authenticate(token);
              if (
                !verified.userId ||
                !Number.isFinite(verified.expiresAt) ||
                verified.expiresAt <= Date.now()
              ) {
                throw new UnauthorizedException('Authentication expired.');
              }
              if (socket.readyState !== WebSocket.OPEN) return;
              principal = verified;
              if (verified.validate) {
                validation = setInterval(async () => {
                  if (validating || socket.readyState !== WebSocket.OPEN)
                    return;
                  validating = true;
                  try {
                    await verified.validate!();
                  } catch {
                    this.send(socket, 'ERROR', {
                      statusCode: 401,
                      code: 'INVALID_TOKEN',
                      message: 'The session is no longer valid.',
                    });
                    this.presence?.disconnect(connectionId);
                    socket.close(4401, 'Session ended');
                  } finally {
                    validating = false;
                  }
                }, 1000);
                validation.unref();
              }
              clearTimeout(authTimeout);
              expiry = setTimeout(
                () => {
                  this.presence?.disconnect(connectionId);
                  socket.close(4401, 'Authentication expired');
                },
                Math.min(verified.expiresAt - Date.now(), 2_147_483_647),
              );
              expiry.unref();
              this.send(socket, 'AUTHENTICATED', { userId: principal.userId });
              const authenticatedClient = {
                userId: verified.userId,
                connected: () =>
                  socket.readyState === WebSocket.OPEN &&
                  verified.expiresAt > Date.now(),
                validate: async () => {
                  await verified.validate?.();
                },
                send: (event: string, data: unknown) =>
                  this.send(socket, event, data),
              };
              this.presence?.connect(connectionId, authenticatedClient);
              this.matchmaking?.connect(connectionId, authenticatedClient);
            } else {
              if (
                principal.expiresAt <= Date.now() ||
                message.event === 'AUTHENTICATE'
              )
                throw new UnauthorizedException(
                  'Authenticate again on a new connection.',
                );
              await principal.validate?.();
              if (socket.readyState !== WebSocket.OPEN) return;
              await this.messages.handle(
                {
                  userId: principal.userId,
                  connectionId,
                  connected: () =>
                    socket.readyState === WebSocket.OPEN &&
                    principal!.expiresAt > Date.now(),
                  send: (event, data) => this.send(socket, event, data),
                },
                message,
              );
            }
          } catch (error: unknown) {
            const response = apiError(error);
            this.send(socket, 'ERROR', response);
            if (!principal || response.statusCode === 401) {
              this.presence?.disconnect(connectionId);
              socket.close(4401, 'Authentication failed');
            }
            if (response.statusCode >= 500)
              this.logger.warn(`Realtime request failed: ${response.code}`);
          }
        })
        .finally(() => {
          --queued;
        });
    });
  }

  private send(socket: WebSocket, event: string, data: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 262_144) {
      socket.close(1013, 'Slow consumer');
      return;
    }
    socket.send(JSON.stringify({ event, data }));
  }
}
