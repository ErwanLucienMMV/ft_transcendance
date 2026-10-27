import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, InjectionToken, PLATFORM_ID, signal } from '@angular/core';
import { catchError, map, of, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { API_BASE_URL } from '../api/api-base-url';
import { AuthService, TwoFactorChallenge } from './auth.service';
import { AuthTokenResponse } from './auth-session';

export type OAuthProvider = 'google' | 'github';
export const OAUTH_NAVIGATE = new InjectionToken<(url: string) => void>('OAUTH_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url) => window.location.assign(url),
});
const isProvider = (p: unknown): p is OAuthProvider => p === 'google' || p === 'github';
@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly navigate = inject(OAUTH_NAVIGATE);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  readonly providers = signal<OAuthProvider[]>([]);

  loadProviders() {
    if (!this.browser) return of([]);
    return this.api.get<{ providers: unknown[] }>('auth/oauth/providers').pipe(
      map((response) =>
        Array.isArray(response.providers) ? response.providers.filter(isProvider) : [],
      ),
      catchError(() => of([])),
      tap((providers) => this.providers.set(providers)),
    );
  }
  start(provider: OAuthProvider): boolean {
    if (
      !this.browser ||
      !isProvider(provider) ||
      !this.providers().includes(provider) ||
      !/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(this.base)
    )
      return false;
    this.navigate(`${this.base}/auth/oauth/${provider}`);
    return true;
  }
  exchange() {
    this.auth.cancelChallenge();
    this.auth.session.clear();
    return this.api
      .post<AuthTokenResponse | TwoFactorChallenge>(
        'auth/oauth/exchange',
        {},
        { headers: { 'x-oauth-exchange': '1' } },
      )
      .pipe(tap((response) => this.auth.acceptSignIn(response)));
  }
  accounts() {
    return this.api.get<{ providers: OAuthProvider[] }>('auth/oauth/accounts', {
      headers: this.headers(),
    });
  }
  link(provider: OAuthProvider) {
    if (!isProvider(provider) || !this.providers().includes(provider))
      throw new Error('This provider is unavailable.');
    return this.api
      .post<{ authorizationUrl: string }>(
        `auth/oauth/${provider}/link`,
        {},
        { headers: this.headers() },
      )
      .pipe(
        tap((response) => {
          const url = new URL(response.authorizationUrl);
          const host = provider === 'google' ? 'accounts.google.com' : 'github.com';
          if (
            url.protocol !== 'https:' ||
            url.hostname !== host ||
            url.port ||
            url.username ||
            url.password
          )
            throw new Error('Invalid provider response.');
          this.navigate(url.toString());
        }),
      );
  }
  unlink(provider: OAuthProvider) {
    if (!isProvider(provider)) throw new Error('Invalid provider.');
    return this.api.delete<void>(`auth/oauth/${provider}`, { headers: this.headers() });
  }
  private headers(): Record<string, string> {
    const token = this.auth.session.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
