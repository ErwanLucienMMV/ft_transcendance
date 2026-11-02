import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { PresenceService } from '../presence/presence.service.js';
import { isUUID } from 'class-validator';

export const MATCH_CHANNEL = 'transcendence_match_found';
interface MatchEvent {
  gameId: string;
  whiteId: string;
  blackId: string;
}
interface MatchClient {
  userId: string;
  connected(): boolean;
  validate(): Promise<void>;
  send(event: string, data: unknown): void;
}
interface NotificationConnection {
  on(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): void;
  on(event: 'error', listener: () => void): void;
  removeListener(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): void;
  removeListener(event: 'error', listener: () => void): void;
}

/** PostgreSQL sends committed matches to each replica's authenticated sockets. */
@Injectable()
export class MatchmakingEvents
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MatchmakingEvents.name);
  private readonly clients = new Map<string, MatchClient>();
  private runner?: QueryRunner;
  private connection?: NotificationConnection;
  private retry?: ReturnType<typeof setTimeout>;
  private closing = false;
  private deliveries: Promise<void> = Promise.resolve();

  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly presence: PresenceService,
  ) {}

  connect(id: string, client: MatchClient): void {
    this.clients.set(id, client);
  }
  disconnect(id: string): void {
    this.clients.delete(id);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.listen();
  }

  private async listen(): Promise<void> {
    const runner = this.source.createQueryRunner();
    this.runner = runner;
    try {
      this.connection = (await runner.connect()) as NotificationConnection;
      this.connection.on('notification', this.notification);
      this.connection.on('error', this.failed);
      await runner.query(`LISTEN ${MATCH_CHANNEL}`);
    } catch {
      await this.release();
      this.scheduleRetry();
    }
  }

  private readonly failed = (): void => {
    void this.release().finally(() => this.scheduleRetry());
  };

  private scheduleRetry(): void {
    if (this.closing || this.retry) return;
    this.logger.warn(
      'Match notifications unavailable; status endpoint remains authoritative.',
    );
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.listen();
    }, 1000);
    this.retry.unref();
  }

  private readonly notification = (message: {
    channel: string;
    payload?: string;
  }): void => {
    if (message.channel !== MATCH_CHANNEL || !message.payload) return;
    let event: MatchEvent;
    try {
      event = JSON.parse(message.payload) as MatchEvent;
      if (
        !event ||
        !isUUID(event.gameId) ||
        !isUUID(event.whiteId) ||
        !isUUID(event.blackId)
      )
        return;
    } catch {
      return;
    }
    this.deliveries = this.deliveries
      .then(() => this.deliver(event))
      .catch(() => {
        this.logger.warn(
          'Match delivery failed; clients can recover through queue status.',
        );
      });
  };

  private async deliver(event: MatchEvent): Promise<void> {
    // A channel is transport, not authority: verify the committed game and seats.
    const rows: { userId: string; color: 'WHITE' | 'BLACK' }[] =
      await this.source.query(
        `SELECT p."userId", p.color FROM game_players p JOIN games g ON g.id = p."gameId"
       WHERE g.id = $1 AND g.status = 'ACTIVE'`,
        [event.gameId],
      );
    if (
      rows.length !== 2 ||
      !rows.some((p) => p.userId === event.whiteId && p.color === 'WHITE') ||
      !rows.some((p) => p.userId === event.blackId && p.color === 'BLACK')
    )
      return;
    this.presence.setGameStatus(
      event.gameId,
      [event.whiteId, event.blackId],
      true,
    );
    for (const [id, client] of this.clients) {
      if (
        ![event.whiteId, event.blackId].includes(client.userId) ||
        !client.connected()
      )
        continue;
      try {
        await client.validate();
        if (this.clients.get(id) !== client || !client.connected()) continue;
        client.send('MATCH_FOUND', {
          gameId: event.gameId,
          color: client.userId === event.whiteId ? 'WHITE' : 'BLACK',
          opponentId:
            client.userId === event.whiteId ? event.blackId : event.whiteId,
        });
      } catch {
        /* One expired/broken socket must not suppress another recipient. */
      }
    }
  }

  async flush(): Promise<void> {
    await this.deliveries;
  }

  private async release(): Promise<void> {
    const runner = this.runner,
      connection = this.connection;
    this.runner = undefined;
    this.connection = undefined;
    connection?.removeListener('notification', this.notification);
    connection?.removeListener('error', this.failed);
    if (runner && !runner.isReleased) {
      try {
        await runner.query(`UNLISTEN ${MATCH_CHANNEL}`);
      } catch {
        /* Lost connection. */
      }
      try {
        await runner.release();
      } catch {
        /* Already disconnected. */
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.retry);
    await this.release();
    await this.flush();
    this.clients.clear();
  }
}
