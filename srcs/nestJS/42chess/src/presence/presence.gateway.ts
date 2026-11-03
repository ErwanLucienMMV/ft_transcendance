import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PresenceService } from './presence.service.js';
import type { LiveGameChange, UserPresence } from './presence.service.js';

interface PresenceConnection {
  userId: string;
  connected: () => boolean;
  validate: () => Promise<void>;
  send: (event: string, data: unknown) => void;
}

/** Private presence notifications on the authenticated shared realtime transport. */
@Injectable()
export class PresenceGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceGateway.name);
  private unsubscribe?: () => void;
  private unsubscribeGames?: () => void;
  private notifications: Promise<void> = Promise.resolve();
  private readonly clients = new Map<string, PresenceConnection>();
  constructor(
    private readonly presence: PresenceService,
    private readonly source: DataSource,
  ) {}

  onModuleInit(): void {
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
    // The live games page refreshes on these instead of polling.
    this.unsubscribeGames = this.presence.subscribeGames((change) => {
      this.notifications = this.notifications
        .then(() => this.broadcast('LIVE_GAMES_CHANGED', change))
        .catch((error: unknown) => {
          this.logger.error('Live game event delivery failed', error);
        });
    });
  }

  /** Public news (a game id and whether it is live): no session check needed per socket. */
  private broadcast(event: string, change: LiveGameChange): void {
    for (const client of this.clients.values()) {
      if (!client.connected()) continue;
      try {
        client.send(event, change);
      } catch (error) {
        this.logger.warn(`Live game event not sent: ${String(error)}`);
      }
    }
  }

  connect(connectionId: string, client: PresenceConnection): void {
    this.clients.set(connectionId, client);
    this.presence.connect(client.userId, connectionId);
  }

  disconnect(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client) return;
    this.clients.delete(connectionId);
    this.presence.disconnect(client.userId, connectionId);
  }

  async flushNotifications(): Promise<void> {
    await this.notifications;
  }

  private async notifyFriends(
    event: string,
    state: UserPresence,
  ): Promise<void> {
    const friends: { id: string }[] = await this.source.query(
      'SELECT CASE WHEN "userId" = $1 THEN "friendId" ELSE "userId" END AS id FROM friendships WHERE "userId" = $1 OR "friendId" = $1',
      [state.userId],
    );
    const recipients = new Set(friends.map((friend) => friend.id));
    for (const [id, client] of this.clients) {
      if (!recipients.has(client.userId) || !client.connected()) continue;
      try {
        await client.validate();
      } catch {
        continue;
      }
      if (this.clients.get(id) !== client || !client.connected()) continue;
      client.send(event, {
        userId: state.userId,
        status: state.status,
        lastSeen: state.lastSeen?.toISOString() ?? null,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribeGames?.();
    for (const id of this.clients.keys()) this.disconnect(id);
    await this.presence.flushSeen();
    await this.flushNotifications();
  }
}
