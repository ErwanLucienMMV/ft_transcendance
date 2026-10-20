import { Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';

export type PresenceStatus = 'ONLINE' | 'IN_GAME' | 'OFFLINE';
export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: Date | null;
}

/** Process-local authenticated sessions, as specified in §29; one entry per tab. */
@Injectable()
export class PresenceService implements OnModuleInit {
  private readonly logger = new Logger(PresenceService.name);
  private readonly games = new Map<string, Set<string>>();
  private readonly listeners = new Set<(state: UserPresence) => void>();
  private readonly sessions = new Map<string, Set<string>>();
  private readonly seen = new Map<string, Date>();

  constructor(@Optional() private readonly source?: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!this.source) return;
    const rows: { userId: string; gameId: string }[] = await this.source.query(
      `SELECT p."userId", p."gameId" FROM game_players p JOIN games g ON g.id = p."gameId" WHERE g.status = 'ACTIVE'`,
    );
    for (const row of rows) this.setGameStatus(row.gameId, [row.userId], true);
  }

  subscribe(listener: (state: UserPresence) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Called only after the game transaction has committed. */
  setGameStatus(
    gameId: string,
    userIds: readonly string[],
    active: boolean,
  ): void {
    const game = this.identifier(gameId);
    for (const userId of userIds) {
      const id = this.identifier(userId),
        before = this.get(id).status;
      const games = this.games.get(id) ?? new Set<string>();
      if (active) games.add(game);
      else games.delete(game);
      if (games.size) this.games.set(id, games);
      else this.games.delete(id);
      this.publish(id, before);
    }
  }

  private publish(id: string, before: PresenceStatus): void {
    const state = this.get(id);
    if (state.status === before) return;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        this.logger.error('Presence listener failed', error);
      }
    }
  }

  get(userId: string): UserPresence {
    const id = this.identifier(userId);
    const lastSeen = this.seen.get(id);
    return {
      userId: id,
      status: this.isOnline(id)
        ? this.games.get(id)?.size
          ? 'IN_GAME'
          : 'ONLINE'
        : 'OFFLINE',
      lastSeen: lastSeen ? new Date(lastSeen) : null,
    };
  }

  isOnline(userId: string): boolean {
    return (this.sessions.get(this.identifier(userId))?.size ?? 0) > 0;
  }

  connect(userId: string, connectionId: string, at = new Date()): boolean {
    const id = this.identifier(userId);
    const before = this.get(id).status;
    if (!connectionId || connectionId.length > 128)
      throw new RangeError('Invalid connection ID');
    const connections = this.sessions.get(id) ?? new Set<string>();
    const wasOffline = connections.size === 0;
    if (!connections.has(connectionId)) {
      connections.add(connectionId);
      this.sessions.set(id, connections);
      this.seen.set(id, new Date(at));
    }
    this.publish(id, before);
    return wasOffline;
  }

  disconnect(userId: string, connectionId: string, at = new Date()): boolean {
    const id = this.identifier(userId);
    const before = this.get(id).status;
    const connections = this.sessions.get(id);
    if (!connections?.delete(connectionId)) return false;
    if (connections.size) return false;
    this.sessions.delete(id);
    this.seen.set(id, new Date(at));
    this.publish(id, before);
    return true;
  }

  private identifier(id: string): string {
    if (typeof id !== 'string' || !isUUID(id))
      throw new RangeError('Invalid user ID');
    return id.toLowerCase();
  }
}
