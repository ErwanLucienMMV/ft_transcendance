import { inject, Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-session';

/** Saved per account (PATCH /users/me merges the keys it is given). */
export interface UserPreferences {
  language: 'en' | 'fr';
  theme: 'light' | 'dark' | 'system';
  soundEnabled: boolean;
  /** Only friends can message or challenge this player. */
  messagesFromFriendsOnly: boolean;
}

export interface CurrentUser extends AuthUser {
  email?: string | null;
  avatarUrl: string | null;
  preferences?: UserPreferences;
  gamesPlayed: number;
  gamesWon: number;
  gamesDraw: number;
  gamesLost: number;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class SessionLifecycle {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  /**
   * Clear tab-local identity immediately. The captured bearer, or the refresh cookie once
   * the bearer has expired, revokes that session only; the server also clears the cookie.
   */
  signOut(): Observable<void> {
    const token = this.auth.session.token();
    const request = this.api.post<void>(
      'auth/logout',
      {},
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
    this.realtime.disconnect();
    this.auth.cancelChallenge();
    this.auth.session.clear();
    return request;
  }

  refreshUser(): Observable<CurrentUser | null> {
    const token = this.auth.session.token();
    if (!token) return of(null);
    return this.api
      .get<CurrentUser>('users/me')
      .pipe(map((user) => (this.auth.session.updateUser(user, token) ? user : null)));
  }
}
