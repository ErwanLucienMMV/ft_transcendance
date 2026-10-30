import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrivateMessagesService } from './private-messages.service.js';
import type { PrivateMessageResponse } from '../messages/message-presenter.js';

const VALIDATION_TIMEOUT_MS = 1000;

interface MessageConnection {
  userId: string;
  connected(): boolean;
  validate(): Promise<void>;
  send(event: string, data: unknown): void;
}

/** Sockets are delivery targets only. PostgreSQL owns every accepted message. */
@Injectable()
export class PrivateMessageRealtime implements OnModuleDestroy {
  private readonly clients = new Map<string, MessageConnection>();

  constructor(private readonly messages: PrivateMessagesService) {}

  connect(id: string, client: MessageConnection): void {
    this.clients.set(id, client);
  }

  disconnect(id: string): void {
    this.clients.delete(id);
  }

  async send(senderId: string, data: Record<string, unknown>): Promise<void> {
    if (
      Object.keys(data).some((key) => !['receiverId', 'content'].includes(key))
    )
      throw new BadRequestException('Unexpected private-message fields.');
    const saved = await this.messages.send(
      senderId,
      data.receiverId,
      data.content,
    );

    // Never acknowledge/broadcast before the save commits. Offline recipients
    // recover via HTTP history; one failed socket cannot undo the saved message
    // or suppress delivery to the remaining valid sessions.
    await Promise.all(
      Array.from(this.clients, ([id, client]) =>
        this.deliver(id, client, saved),
      ),
    );
  }

  private async deliver(
    id: string,
    client: MessageConnection,
    saved: PrivateMessageResponse,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (
        ![saved.senderId, saved.receiverId].includes(client.userId) ||
        !client.connected()
      )
        return;
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
      client.send('PRIVATE_MESSAGE', saved);
    } catch {
      // A revoked, stalled or broken connection cannot delay healthy sessions.
      // After timeout, late validation results never resume this delivery.
      // The committed message remains available through authenticated history.
    } finally {
      clearTimeout(timeout);
    }
  }

  onModuleDestroy(): void {
    this.clients.clear();
  }
}
