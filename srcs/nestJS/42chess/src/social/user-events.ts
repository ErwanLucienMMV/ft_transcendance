import { Injectable, OnModuleDestroy } from '@nestjs/common';

const VALIDATION_TIMEOUT_MS = 1000;

/** An authenticated socket, as the realtime gateway registers it. */
export interface UserConnection {
  userId: string;
  connected(): boolean;
  validate(): Promise<void>;
  send(event: string, data: unknown): void;
}

/**
 * Pushes events to every open socket of given users: private messages, friend requests,
 * challenges, read receipts and typing. Sockets are delivery targets only; whatever the
 * event announces is already saved, and the HTTP API returns it to a later reader.
 */
@Injectable()
export class UserEvents implements OnModuleDestroy {
  private readonly clients = new Map<string, UserConnection>();
  // Connections by user: an event reaches its recipients without scanning every socket.
  private readonly byUser = new Map<string, Set<string>>();

  connect(id: string, client: UserConnection): void {
    this.disconnect(id);
    this.clients.set(id, client);
    const ids = this.byUser.get(client.userId) ?? new Set<string>();
    ids.add(id);
    this.byUser.set(client.userId, ids);
  }

  disconnect(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    const ids = this.byUser.get(client.userId);
    ids?.delete(id);
    if (ids?.size === 0) this.byUser.delete(client.userId);
  }

  /** Whether the user has an open socket right now. */
  online(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  /**
   * Sends the event to each open socket of these users, once each session is confirmed still
   * valid. A revoked, stalled or broken socket never delays the others.
   */
  async send(
    userIds: string[],
    event: string,
    data: unknown,
    except?: string,
  ): Promise<void> {
    const targets = [...new Set(userIds)].flatMap((userId) =>
      [...(this.byUser.get(userId) ?? [])].flatMap((id) => {
        const client = this.clients.get(id);
        return client && id !== except
          ? [[id, client] as [string, UserConnection]]
          : [];
      }),
    );
    await Promise.all(
      targets.map(([id, client]) => this.deliver(id, client, event, data)),
    );
  }

  private async deliver(
    id: string,
    client: UserConnection,
    event: string,
    data: unknown,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!client.connected()) return;
      await Promise.race([
        client.validate(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Session validation timed out.')),
            VALIDATION_TIMEOUT_MS,
          );
          timeout.unref();
        }),
      ]);
      if (this.clients.get(id) !== client || !client.connected()) return;
      client.send(event, data);
    } catch {
      // After a timeout, a late validation never resumes this delivery.
    } finally {
      clearTimeout(timeout);
    }
  }

  onModuleDestroy(): void {
    this.clients.clear();
    this.byUser.clear();
  }
}
