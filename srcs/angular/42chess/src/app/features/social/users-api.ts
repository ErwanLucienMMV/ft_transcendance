import { inject, Injectable } from '@angular/core';
import { filter, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { AUTH_FIELD_LIMITS } from '../auth/auth-form.models';

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
  elo: number;
  status: PresenceStatus;
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

/** Public profiles, player search and the signed-in user's friends. */
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
}
