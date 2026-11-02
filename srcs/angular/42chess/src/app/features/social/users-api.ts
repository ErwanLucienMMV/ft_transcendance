import { inject, Injectable } from '@angular/core';
import { filter, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { AUTH_FIELD_LIMITS } from '../auth/auth-form.models';
import { tr } from '../../core/i18n/i18n';

/** Spec §29; a game in progress counts as online. */
export type PresenceStatus = 'ONLINE' | 'IN_GAME' | 'OFFLINE';

/** GET /users/:id (spec §4): only public columns, readable without signing in. */
export interface PublicProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  elo: number;
  gamesPlayed: number;
  online: boolean;
}
export interface PlayerSearchResult {
  id: string;
  username: string;
  avatarUrl?: string | null;
  elo: number;
  online: boolean;
}
export interface RatingChange {
  gameId: string;
  ratingBefore: number;
  ratingAfter: number;
  change: number;
  createdAt: string;
}
export interface Friend {
  id: string;
  username: string;
  avatarUrl?: string | null;
  elo: number;
  status: PresenceStatus;
}
/** The request DTO carries ids only; the page reads the other player's public profile. */
export interface FriendRequest {
  id: string;
  senderId: string;
  recipientId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
}
/** What the friends pages show of the other player of a request. */
export interface RequestPlayer {
  id: string;
  username: string;
  avatarUrl?: string | null;
  elo: number;
}
export interface BlockedPlayer {
  id: string;
  username: string;
  avatarUrl: string | null;
  blockedAt: string;
}

/** Friendship changes pushed to every open tab of both players. */
export type SocialEvent =
  | { type: 'request-received'; request: FriendRequest; sender: RequestPlayer }
  | { type: 'request-sent'; request: FriendRequest }
  | { type: 'request-removed'; requestId: string }
  | { type: 'friend-added'; requestId: string | null; friend: Friend }
  | { type: 'friend-removed'; userId: string };

/** Texts for the friend request codes; other codes keep the server's own sentence. */
const FRIEND_CODES = [
  'FRIEND_REQUEST_SELF',
  'FRIEND_REQUEST_FORBIDDEN',
  'ALREADY_FRIENDS',
  'FRIEND_REQUEST_PENDING',
  'FRIEND_REQUEST_DECLINED_RECENTLY',
] as const;
export function friendErrors(): Record<string, string> {
  return Object.fromEntries(FRIEND_CODES.map((code) => [code, tr(`social.errors.${code}`)]));
}

/** The search accepts any username fragment, up to a full username. */
export const SEARCH_MAX_LENGTH = AUTH_FIELD_LIMITS.usernameMax;

const PRESENCE_EVENTS = new Set(['USER_ONLINE', 'USER_OFFLINE', 'USER_STATUS_CHANGED']);
const STATUSES = new Set<unknown>(['ONLINE', 'IN_GAME', 'OFFLINE']);

/**
 * Friends' presence changes, pushed on the signed-in socket (spec §29). The server only sends
 * them about the recipient's friends.
 */
export function presenceChanges(
  realtime: RealtimeService,
): Observable<{ userId: string; status: PresenceStatus }> {
  return realtime.events.pipe(
    filter(
      ({ event, data }) =>
        PRESENCE_EVENTS.has(event) &&
        typeof data['userId'] === 'string' &&
        STATUSES.has(data['status']),
    ),
    map(({ data }) => ({
      userId: data['userId'] as string,
      status: data['status'] as PresenceStatus,
    })),
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isRequest = (value: unknown): value is FriendRequest =>
  isObject(value) &&
  ['id', 'senderId', 'recipientId', 'status', 'createdAt'].every(
    (key) => typeof value[key] === 'string',
  );
const isPlayer = (value: unknown): value is RequestPlayer =>
  isObject(value) &&
  typeof value['id'] === 'string' &&
  typeof value['username'] === 'string' &&
  typeof value['elo'] === 'number';

/** FRIEND_* events of the signed-in socket, checked and typed; anything malformed is dropped. */
export function socialEvents(realtime: RealtimeService): Observable<SocialEvent> {
  return realtime.events.pipe(
    map(({ event, data }): SocialEvent | null => {
      switch (event) {
        case 'FRIEND_REQUEST_RECEIVED':
          return isRequest(data['request']) && isPlayer(data['sender'])
            ? { type: 'request-received', request: data['request'], sender: data['sender'] }
            : null;
        case 'FRIEND_REQUEST_SENT':
          return isRequest(data['request'])
            ? { type: 'request-sent', request: data['request'] }
            : null;
        case 'FRIEND_REQUEST_REMOVED':
          return typeof data['requestId'] === 'string'
            ? { type: 'request-removed', requestId: data['requestId'] }
            : null;
        case 'FRIEND_ADDED': {
          const friend = data['friend'];
          return isPlayer(friend) && STATUSES.has((friend as Partial<Friend>).status)
            ? {
                type: 'friend-added',
                requestId: typeof data['requestId'] === 'string' ? data['requestId'] : null,
                friend: friend as Friend,
              }
            : null;
        }
        case 'FRIEND_REMOVED':
          return typeof data['userId'] === 'string'
            ? { type: 'friend-removed', userId: data['userId'] }
            : null;
        default:
          return null;
      }
    }),
    filter((event): event is SocialEvent => event !== null),
  );
}

/** Public profiles, player search, and the signed-in user's friends, requests and blocks. */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly api = inject(ApiClient);

  profile(id: string): Observable<PublicProfile> {
    return this.api.get(`users/${encodeURIComponent(id)}`);
  }

  /** Case-insensitive username fragment, alphabetical. */
  search(q: string, limit = 20): Observable<{ users: PlayerSearchResult[] }> {
    return this.api.get('users/search', { params: { q, limit } });
  }

  /** Newest change first. */
  ratingHistory(id: string, limit: number): Observable<{ history: RatingChange[] }> {
    return this.api.get(`users/${encodeURIComponent(id)}/rating-history`, {
      params: { limit, offset: 0 },
    });
  }

  friends(): Observable<{ friends: Friend[] }> {
    return this.api.get('friends');
  }

  /** Pending requests sent to the signed-in user, oldest first. */
  friendRequests(): Observable<{ requests: FriendRequest[] }> {
    return this.api.get('friends/requests');
  }

  /** Pending requests the signed-in user sent, oldest first. */
  sentFriendRequests(): Observable<{ requests: FriendRequest[] }> {
    return this.api.get('friends/requests/sent');
  }

  /** Status ACCEPTED when the other player had already asked: you are friends at once. */
  sendFriendRequest(recipientId: string): Observable<FriendRequest> {
    return this.api.post('friends/requests', { recipientId });
  }

  acceptFriendRequest(id: string): Observable<FriendRequest> {
    return this.api.post(`friends/requests/${encodeURIComponent(id)}/accept`, {});
  }

  /** The recipient declines it; the sender withdraws it. */
  removeFriendRequest(id: string): Observable<void> {
    return this.api.delete(`friends/requests/${encodeURIComponent(id)}`);
  }

  /** Players the signed-in user blocked, alphabetical. */
  blocked(): Observable<{ users: BlockedPlayer[] }> {
    return this.api.get('blocks');
  }

  /** Ends any friendship, request or open challenge between you; they are not told. */
  block(userId: string): Observable<void> {
    return this.api.put(`blocks/${encodeURIComponent(userId)}`, {});
  }

  unblock(userId: string): Observable<void> {
    return this.api.delete(`blocks/${encodeURIComponent(userId)}`);
  }

  removeFriend(friendId: string): Observable<void> {
    return this.api.delete(`friends/${encodeURIComponent(friendId)}`);
  }
}
