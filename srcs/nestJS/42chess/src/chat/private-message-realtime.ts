import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrivateMessagesService } from './private-messages.service.js';

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
    for (const [id, client] of this.clients) {
      if (
        ![saved.senderId, saved.receiverId].includes(client.userId) ||
        !client.connected()
      )
        continue;
      try {
        await client.validate();
        if (this.clients.get(id) !== client || !client.connected()) continue;
        client.send('PRIVATE_MESSAGE', saved);
      } catch {
        // Revoked sessions and broken transports must recover through a valid
        // session and durable history, never through a retry of the saved send.
      }
    }
  }

  onModuleDestroy(): void {
    this.clients.clear();
  }
}
