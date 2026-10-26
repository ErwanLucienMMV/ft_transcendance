import type {
  CollectionResponse,
  ISODateString,
  UUID,
} from '../common/types/api.js';
import type { User } from '../users/user.entity.js';
import type { FriendRequest } from './friend-requests.entity.js';

/** Only public profile fields cross the friendship API boundary. */
export interface FriendResponse {
  id: UUID;
  username: string;
  avatarUrl: string | null;
  elo: number;
  lastSeenAt: ISODateString | null;
}

export type FriendsResponse = CollectionResponse<'friends', FriendResponse>;

export interface FriendRequestResponse {
  id: UUID;
  senderId: UUID;
  recipientId: UUID;
  status: string;
  createdAt: ISODateString;
}

export function toFriendRequest(request: FriendRequest): FriendRequestResponse {
  return {
    id: request.id,
    senderId: request.senderId,
    recipientId: request.recipientId,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}

export function toFriend(
  user: Pick<User, 'id' | 'username' | 'avatarUrl' | 'elo' | 'lastSeenAt'>,
): FriendResponse {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    elo: user.elo,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  };
}
