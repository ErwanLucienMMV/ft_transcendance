import { inject, Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-session';
import { SERVER_AUTH_CAPABILITIES } from './server-auth-capabilities';

export interface CurrentUser extends AuthUser {
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
  readonly capabilities = inject(SERVER_AUTH_CAPABILITIES);

  /** Local cleanup is immediate, including if the optional server request fails. */
  signOut(): Observable<void> {
    const token = this.auth.session.token();
    const request =
      this.capabilities.logout && token
        ? this.api.post<void>('auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } })
        : of(undefined);
    this.realtime.disconnect();
    this.auth.cancelChallenge();
    this.auth.session.clear();
    return request;
  }

  /** Refreshes an existing memory session; does not invent a reload/refresh-token flow. */
  refreshUser(): Observable<CurrentUser | null> {
    const token = this.auth.session.token();
    if (!this.capabilities.currentUser || !token) return of(null);
    return this.api
      .get<CurrentUser>('users/me')
      .pipe(map((user) => (this.auth.session.updateUser(user, token) ? user : null)));
  }
}
