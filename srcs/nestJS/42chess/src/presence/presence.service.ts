import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

export type PresenceStatus = 'ONLINE' | 'IN_GAME' | 'OFFLINE';
export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: Date | null;
}

/** Process-local authenticated sessions, as specified in §29; one entry per tab. */
@Injectable()
export class PresenceService {
  private readonly sessions = new Map<string, Set<string>>();
  private readonly seen = new Map<string, Date>();

  get(userId: string): UserPresence {
    const id = this.identifier(userId);
    const lastSeen = this.seen.get(id);
    return {
      userId: id,
      status: this.isOnline(id) ? 'ONLINE' : 'OFFLINE',
      lastSeen: lastSeen ? new Date(lastSeen) : null,
    };
  }

  isOnline(userId: string): boolean {
    return (this.sessions.get(this.identifier(userId))?.size ?? 0) > 0;
  }

  connect(userId: string, connectionId: string, at = new Date()): boolean {
    const id = this.identifier(userId);
    if (!connectionId || connectionId.length > 128)
      throw new RangeError('Invalid connection ID');
    const connections = this.sessions.get(id) ?? new Set<string>();
    const wasOffline = connections.size === 0;
    if (!connections.has(connectionId)) {
      connections.add(connectionId);
      this.sessions.set(id, connections);
      this.seen.set(id, new Date(at));
    }
    return wasOffline;
  }

  disconnect(userId: string, connectionId: string, at = new Date()): boolean {
    const id = this.identifier(userId);
    const connections = this.sessions.get(id);
    if (!connections?.delete(connectionId)) return false;
    if (connections.size) return false;
    this.sessions.delete(id);
    this.seen.set(id, new Date(at));
    return true;
  }

  private identifier(id: string): string {
    if (typeof id !== 'string' || !isUUID(id))
      throw new RangeError('Invalid user ID');
    return id.toLowerCase();
  }
}
