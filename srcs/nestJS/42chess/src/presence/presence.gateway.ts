import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebSocket, WebSocketServer } from 'ws';
import { User } from '../users/user.entity.js';
import { verifyAccessToken } from '../auth/access-token.guard.js';
import type { Environment } from '../config/environment.js';
import { PresenceService } from './presence.service.js';
import type { UserPresence } from './presence.service.js';

/** Native JSON WebSocket transport used by the frontend: { event, data }. */
@Injectable()
export class PresenceGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceGateway.name);
  private unsubscribe?: () => void;
  private notifications: Promise<void> = Promise.resolve();
  private server?: WebSocketServer;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly alive = new WeakSet<WebSocket>();
  private readonly clients = new Map<
    WebSocket,
    { userId: string; connectionId: string }
  >();
  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly presence: PresenceService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  onModuleInit(): void {
    this.server = new WebSocketServer({
      server: this.adapter.httpAdapter.getHttpServer(),
      path: '/ws',
      maxPayload: 16384,
    });
    this.server.on('connection', (socket) => this.accept(socket));
    this.heartbeat = setInterval(() => this.checkConnections(), 30000);
    this.heartbeat.unref();
    this.unsubscribe = this.presence.subscribe((state, previous) => {
      const event =
        state.status === 'OFFLINE'
          ? 'USER_OFFLINE'
          : previous === 'OFFLINE'
            ? 'USER_ONLINE'
            : 'USER_STATUS_CHANGED';
      this.notifications = this.notifications
        .then(() => this.notifyFriends(event, state))
        .catch((error: unknown) => {
          this.logger.error('Presence event delivery failed', error);
        });
    });
  }

  async flushNotifications(): Promise<void> {
    await this.notifications;
  }

  private async notifyFriends(
    event: string,
    state: UserPresence,
  ): Promise<void> {
    const friends: { id: string }[] = await this.users.manager.query(
      `SELECT CASE WHEN "userId" = $1 THEN "friendId" ELSE "userId" END AS id
       FROM friendships WHERE "userId" = $1 OR "friendId" = $1`,
      [state.userId],
    );
    const recipients = new Set(friends.map((friend) => friend.id));
    const packet = JSON.stringify({
      event,
      data: {
        userId: state.userId,
        status: state.status,
        lastSeen: state.lastSeen?.toISOString() ?? null,
      },
    });
    for (const [socket, session] of this.clients) {
      if (
        recipients.has(session.userId) &&
        socket.readyState === WebSocket.OPEN
      )
        socket.send(packet);
    }
  }

  /** Ping/pong detects dead TCP peers without relying on a close frame. */
  checkConnections(): void {
    for (const socket of this.server?.clients ?? []) {
      if (socket.readyState !== WebSocket.OPEN || !this.alive.has(socket)) {
        this.release(socket);
        socket.terminate();
      } else {
        this.alive.delete(socket);
        socket.ping();
      }
    }
  }

  private release(socket: WebSocket): void {
    const session = this.clients.get(socket);
    if (!session) return;
    this.clients.delete(socket);
    this.presence.disconnect(session.userId, session.connectionId);
  }

  private accept(socket: WebSocket): void {
    this.alive.add(socket);
    socket.on('pong', () => this.alive.add(socket));
    const connectionId = randomUUID();
    let authenticating = false;
    let expires: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(
      () => socket.close(4401, 'Authentication required'),
      8000,
    );
    deadline.unref();
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(deadline);
      clearTimeout(expires);
      this.release(socket);
    });
    socket.on('message', (raw, binary) => {
      void (async () => {
        try {
          if (binary || authenticating)
            return socket.close(1008, 'Invalid message');
          const bytes = Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(raw);
          const packet: unknown = JSON.parse(bytes.toString('utf8'));
          if (
            !packet ||
            typeof packet !== 'object' ||
            !('event' in packet) ||
            !('data' in packet)
          )
            return socket.close(1008, 'Invalid message');
          if (this.clients.has(socket)) {
            if (packet.event === 'AUTHENTICATE')
              return socket.close(1008, 'Already authenticated');
            socket.send(
              JSON.stringify({
                event: 'ERROR',
                data: { code: 'UNKNOWN_EVENT', message: 'Unsupported event.' },
              }),
            );
            return;
          }
          const data = packet.data;
          if (
            packet.event !== 'AUTHENTICATE' ||
            !data ||
            typeof data !== 'object' ||
            !('accessToken' in data) ||
            typeof data.accessToken !== 'string' ||
            data.accessToken.length > 8192
          )
            return socket.close(4401, 'Authentication required');
          authenticating = true;
          const subject = await verifyAccessToken(
            this.jwt,
            this.config.get('JWT_SECRET', { infer: true }),
            data.accessToken,
          );
          const user = await this.users.findOneBy({ id: subject.id });
          if (!user?.emailVerifiedAt)
            return socket.close(4401, 'Invalid account');
          if (socket.readyState !== WebSocket.OPEN) return;
          this.clients.set(socket, { userId: user.id, connectionId });
          this.presence.connect(user.id, connectionId);
          clearTimeout(deadline);
          const expire = () => {
            const remaining = subject.expiresAt - Date.now();
            if (remaining <= 0) {
              this.release(socket);
              socket.close(4401, 'Access token expired');
            } else {
              expires = setTimeout(expire, Math.min(remaining, 2_147_483_647));
              expires.unref();
            }
          };
          expire();
          socket.send(
            JSON.stringify({
              event: 'AUTHENTICATED',
              data: { userId: user.id },
            }),
          );
        } catch {
          socket.close(4401, 'Invalid authentication');
        } finally {
          authenticating = false;
        }
      })();
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    clearInterval(this.heartbeat);
    if (!this.server) return;
    for (const socket of this.server.clients) {
      this.release(socket);
      socket.terminate();
    }
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    await this.presence.flushSeen();
    await this.flushNotifications();
  }
}
