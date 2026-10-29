import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { catchError, finalize, map, Observable, of, shareReplay } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { AuthSession, AuthTokenResponse } from './auth-session';

// Renew this long before the access token expires, so requests never carry a dead token.
const RENEW_AHEAD_MS = 60_000;
const RETRY_MS = 30_000;

/**
 * Keeps the in-memory access token alive from the httpOnly refresh cookie: restores it
 * after a page reload and renews it before it expires. The cookie itself is never readable
 * here; the browser sends it only to /api/v1/auth.
 */
@Injectable({ providedIn: 'root' })
export class SessionRefresh {
  private readonly api = inject(ApiClient);
  private readonly session = inject(AuthSession);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private pending: Observable<string | null> | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly restored = signal(false);
  /** True once the startup restore has answered; guards wait for it before redirecting. */
  readonly settled = this.restored.asReadonly();

  constructor() {
    effect(() => {
      const expiresAt = this.session.expiresAt();
      untracked(() => this.schedule(expiresAt));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  /** Called once at startup; a missing or revoked cookie simply leaves the visitor signed out. */
  restore(): void {
    if (!this.browser || this.restored()) {
      this.restored.set(true);
      return;
    }
    this.renew()
      .pipe(finalize(() => this.restored.set(true)))
      .subscribe();
  }

  /**
   * One shared request however many callers ask at once. Emits the new access token, or
   * null when the session cannot be renewed. A reply that arrives after the user signed
   * out or signed in again is ignored, so it can never resurrect or replace a session.
   */
  renew(): Observable<string | null> {
    if (!this.browser) return of(null);
    if (this.pending) return this.pending;
    const before = this.session.token();
    this.pending = this.api
      // 204 (null body) means there is no session to restore: a normal, silent answer.
      .post<AuthTokenResponse | null>('auth/refresh', {}, { headers: { 'X-Session-Refresh': '1' } })
      .pipe(
        map((response) => {
          if (this.session.token() !== before) return this.session.token();
          if (!response) {
            if (before) this.session.clear('Your session expired. Please sign in again.');
            return null;
          }
          this.session.establish(response);
          return response.accessToken;
        }),
        catchError((error: unknown) => {
          const expired = error instanceof ApiError && error.statusCode === 401;
          if (before && this.session.token() === before) {
            if (expired) this.session.clear('Your session expired. Please sign in again.');
            else this.retryLater();
          }
          return of(null);
        }),
        finalize(() => (this.pending = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.pending;
  }

  private schedule(expiresAt: number | null): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.browser || expiresAt === null) return;
    const delay = Math.max(expiresAt - Date.now() - RENEW_AHEAD_MS, 0);
    this.timer = setTimeout(() => this.renew().subscribe(), Math.min(delay, 2_147_483_647));
  }

  // A network failure keeps the current token; AuthSession still drops it at its expiry.
  private retryLater(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renew().subscribe(), RETRY_MS);
  }
}
