import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrivateMessagesService } from './private-messages.service.js';
import { UserEvents } from '../social/user-events.js';
import type { UserConnection } from '../social/user-events.js';

/** A player announces typing at most this often to the same peer. */
export const TYPING_INTERVAL_MS = 2000;

/** Sockets are delivery targets only. PostgreSQL owns every accepted message. */
@Injectable()
export class PrivateMessageRealtime implements OnModuleDestroy {
  private readonly typing = new Map<string, number>();

  constructor(
    private readonly messages: PrivateMessagesService,
    @Optional() private readonly events: UserEvents = new UserEvents(),
  ) {}

  connect(id: string, client: UserConnection): void {
    this.events.connect(id, client);
  }

  disconnect(id: string): void {
    this.events.disconnect(id);
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
    await this.events.send(
      [saved.senderId, saved.receiverId],
      'PRIVATE_MESSAGE',
      saved,
    );
  }

  /**
   * The sender sees "Read"; the reader's other tabs clear their unread count. After a
   * block, in either direction, the peer is no longer told when the reader reads.
   */
  async markRead(readerId: string, peerId: string): Promise<void> {
    const read = await this.messages.markRead(readerId, peerId);
    if (!read) return;
    const blocked = await this.messages.blockedBetween(readerId, peerId);
    await this.events.send(
      blocked ? [readerId] : [peerId, readerId],
      'MESSAGES_READ',
      {
        readerId,
        senderId: peerId,
        readAt: read.readAt,
        messageIds: read.messageIds,
      },
    );
  }

  /**
   * "Typing…" is a hint, never an error: a malformed, too frequent or unwelcome one is
   * dropped silently.
   */
  async announceTyping(
    senderId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const receiverId = data.receiverId;
    if (
      Object.keys(data).length !== 1 ||
      typeof receiverId !== 'string' ||
      !isUUID(receiverId) ||
      receiverId.toLowerCase() === senderId
    )
      return;
    const peer = receiverId.toLowerCase();
    const key = `${senderId}:${peer}`;
    const now = Date.now();
    if (now - (this.typing.get(key) ?? 0) < TYPING_INTERVAL_MS) return;
    this.typing.set(key, now);
    if (this.typing.size > 10_000)
      for (const [entry, at] of this.typing)
        if (now - at >= TYPING_INTERVAL_MS) this.typing.delete(entry);
    if (!this.events.online(peer)) return;
    if (!(await this.messages.mayWrite(senderId, peer))) return;
    await this.events.send([peer], 'TYPING', { userId: senderId });
  }

  onModuleDestroy(): void {
    this.typing.clear();
  }
}
