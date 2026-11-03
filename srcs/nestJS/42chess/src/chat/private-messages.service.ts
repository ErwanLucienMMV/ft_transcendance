import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ContactRules } from '../social/contact-rules.js';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { QueryFailedError, Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/pagination.js';
import { Message } from '../messages/messages.entity.js';
import { isMessageContent } from '../messages/message-content.js';
import { toPrivateMessage } from '../messages/message-presenter.js';
import type {
  ConversationResponse,
  PrivateMessageResponse,
} from '../messages/message-presenter.js';
import { User } from '../users/user.entity.js';

export interface PrivateMessageHistory {
  messages: PrivateMessageResponse[];
  total: number;
  limit: number;
  offset: number;
}

function userNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'USER_NOT_FOUND',
    message: 'User not found.',
  });
}

@Injectable()
export class PrivateMessagesService {
  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Optional() private readonly contacts?: ContactRules,
  ) {}

  /** Resolves an account, never a socket or chat-room membership. */
  private async peer(actorId: string, value: unknown): Promise<string> {
    if (typeof value !== 'string' || !isUUID(value))
      throw new BadRequestException('A receiver UUID is required.');
    const id = value.toLowerCase();
    if (id === actorId.toLowerCase())
      throw new BadRequestException('Cannot message yourself.');
    if (!(await this.users.existsBy({ id }))) throw userNotFound();
    return id;
  }

  async send(
    senderId: string,
    receiver: unknown,
    content: unknown,
  ): Promise<PrivateMessageResponse> {
    if (!isMessageContent(content))
      throw new BadRequestException(
        'Message content must contain 1 to 2000 characters.',
      );
    const recipientId = await this.peer(senderId, receiver);
    await this.contacts?.check(senderId, recipientId, 'message');
    let saved: Message;
    try {
      saved = await this.messages.save(
        this.messages.create({ senderId, recipientId, content, readAt: null }),
      );
    } catch (error: unknown) {
      // The recipient can disappear after peer() checks it. The foreign key
      // prevents an orphan; expose the same error as an initially missing peer.
      if (error instanceof QueryFailedError) {
        const { code, constraint } = error.driverError as {
          code?: string;
          constraint?: string;
        };
        if (code === '23503' && constraint === 'FK_messages_recipientId')
          throw userNotFound();
      }
      throw error;
    }
    // save() has committed before the caller may announce this message.
    return toPrivateMessage(saved);
  }

  /**
   * Marks every message from this peer as read now. Returns what changed, or null when
   * nothing was unread.
   */
  async markRead(
    readerId: string,
    peerId: string,
  ): Promise<{ readAt: string; messageIds: string[] } | null> {
    const peer = await this.peer(readerId, peerId);
    const [rows] = (await this.messages.query(
      `UPDATE messages SET "readAt" = now()
       WHERE "senderId" = $1 AND "recipientId" = $2 AND "readAt" IS NULL
       RETURNING id, "readAt"`,
      [peer, readerId],
    )) as [{ id: string; readAt: Date }[], number];
    if (!rows.length) return null;
    return {
      readAt: rows[0].readAt.toISOString(),
      messageIds: rows.map((row) => row.id),
    };
  }

  /** Whether either player blocked the other. */
  async blockedBetween(first: string, second: string): Promise<boolean> {
    const [row] = (await this.messages.query(
      `SELECT EXISTS (SELECT 1 FROM user_blocks
         WHERE ("blockerId" = $1 AND "blockedId" = $2) OR ("blockerId" = $2 AND "blockedId" = $1)
       ) AS blocked`,
      [first, second],
    )) as { blocked: boolean }[];
    return row.blocked;
  }

  /** Whether this player may write to that one: used before announcing typing. */
  async mayWrite(senderId: string, receiverId: string): Promise<boolean> {
    try {
      await this.contacts?.check(senderId, receiverId, 'message');
      return true;
    } catch {
      return false;
    }
  }

  async history(
    actorId: string,
    receiver: string,
    page: PaginationQueryDto,
  ): Promise<PrivateMessageHistory> {
    const peer = await this.peer(actorId, receiver);
    const [rows, total] = await this.messages.findAndCount({
      where: [
        { senderId: actorId, recipientId: peer },
        { senderId: peer, recipientId: actorId },
      ],
      order: { createdAt: 'DESC', id: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
    return {
      messages: rows.map(toPrivateMessage),
      total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  async conversations(
    actorId: string,
  ): Promise<{ conversations: ConversationResponse[] }> {
    // One query and one row per peer. Do not load entire conversations or expose
    // account fields to compute summaries; read state is incoming-only.
    const rows: (Message & {
      peerId: string;
      username: string;
      avatarUrl: string | null;
      unreadCount: number;
    })[] = await this.messages.query(
      `
      WITH ranked AS (
        SELECT m.*,
          CASE WHEN "senderId" = $1 THEN "recipientId" ELSE "senderId" END AS "peerId",
          row_number() OVER (PARTITION BY
            CASE WHEN "senderId" = $1 THEN "recipientId" ELSE "senderId" END
            ORDER BY "createdAt" DESC, id DESC) AS position,
          (count(*) FILTER (WHERE "recipientId" = $1 AND "readAt" IS NULL) OVER (PARTITION BY
            CASE WHEN "senderId" = $1 THEN "recipientId" ELSE "senderId" END))::int AS "unreadCount"
        FROM messages m WHERE "senderId" = $1 OR "recipientId" = $1
      )
      SELECT r.*, u.username, u."avatarUrl" FROM ranked r JOIN users u ON u.id = r."peerId"
      WHERE position = 1 ORDER BY r."createdAt" DESC, r.id DESC`,
      [actorId],
    );
    return {
      conversations: rows.map((row) => ({
        user: {
          id: row.peerId,
          username: row.username,
          avatarUrl: row.avatarUrl,
        },
        lastMessage: toPrivateMessage(this.messages.create(row)),
        unreadCount: row.unreadCount,
      })),
    };
  }
}
