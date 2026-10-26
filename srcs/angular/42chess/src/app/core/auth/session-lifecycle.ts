import { inject, Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-session';

export interface CurrentUser extends AuthUser {
  email?: string | null;
  avatarUrl: string | null;
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

  /** Clear tab-local identity immediately; the captured bearer revokes that session only. */
  signOut(): Observable<void> {
    const token = this.auth.session.token();
    const request = token
      ? this.api.post<void>('auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } })
      : of(undefined);
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
