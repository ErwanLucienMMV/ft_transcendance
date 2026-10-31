import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { QueryFailedError, Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/pagination.js';
import { Message } from '../messages/messages.entity.js';
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
    // PostgreSQL varchar counts Unicode code points, rather than UTF-16 units.
    // In Unicode regex mode, this range matches only unpaired surrogates;
    // valid surrogate pairs (including emoji) are single code points.
    if (
      typeof content !== 'string' ||
      !content.trim() ||
      Array.from(content).length > 2000 ||
      content.includes('\0') ||
      /[\uD800-\uDFFF]/u.test(content)
    )
      throw new BadRequestException(
        'Message content must contain 1 to 2000 characters.',
      );
    const recipientId = await this.peer(senderId, receiver);
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
      SELECT r.*, u.username FROM ranked r JOIN users u ON u.id = r."peerId"
      WHERE position = 1 ORDER BY r."createdAt" DESC, r.id DESC`,
      [actorId],
    );
    return {
      conversations: rows.map((row) => ({
        user: { id: row.peerId, username: row.username },
        lastMessage: toPrivateMessage(this.messages.create(row)),
        unreadCount: row.unreadCount,
      })),
    };
  }
}
