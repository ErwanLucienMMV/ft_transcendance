import type { ISODateString, UUID } from '../common/types/api.js';
import type { User } from '../users/user.entity.js';
import type { Message } from './messages.entity.js';
import type { GameMessage } from './game-messages.entity.js';
import type { Repository } from 'typeorm';
import { IsNull } from 'typeorm';

export interface PrivateMessageResponse {
  id: UUID;
  senderId: UUID;
  receiverId: UUID;
  content: string;
  createdAt: ISODateString;
}
export interface GameMessageResponse {
  id: UUID;
  gameId: UUID;
  sender: { id: UUID; username: string };
  content: string;
  createdAt: ISODateString;
}
export interface ConversationResponse {
  user: { id: UUID; username: string };
  lastMessage: PrivateMessageResponse;
  unreadCount: number;
}
export function toPrivateMessage(row: Message): PrivateMessageResponse {
  return {
    id: row.id,
    senderId: row.senderId,
    receiverId: row.receiverId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}
export function toGameMessage(
  row: GameMessage,
  sender: Pick<User, 'id' | 'username'>,
): GameMessageResponse {
  if (row.userId !== sender.id)
    throw new Error('Game message sender does not match author');
  return {
    id: row.id,
    gameId: row.gameId,
    sender: { id: sender.id, username: sender.username },
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}
/** Incoming messages only. No private state is inferred from who sent the latest message. */
export function countUnread(
  repository: Repository<Message>,
  receiverId: UUID,
  senderId: UUID,
): Promise<number> {
  return repository.countBy({
    recipientId: receiverId,
    senderId,
    readAt: IsNull(),
  });
}
