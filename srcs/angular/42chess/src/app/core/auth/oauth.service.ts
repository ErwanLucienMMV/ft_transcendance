import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, InjectionToken, PLATFORM_ID } from '@angular/core';
import { API_BASE_URL } from '../api/api-base-url';

export type OAuthProvider = 'google' | 'github';
/** Enable individually after Nicolas's provider routes and callback handoff are verified. */
export const OAUTH_PROVIDERS = new InjectionToken<readonly OAuthProvider[]>('OAUTH_PROVIDERS', {
  providedIn: 'root',
  factory: () => [],
});
export const OAUTH_NAVIGATE = new InjectionToken<(url: string) => void>('OAUTH_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url) => window.location.assign(url),
});
const endpoints: Record<OAuthProvider, string> = {
  google: 'auth/oauth/google',
  github: 'auth/oauth/github',
};

@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly providers = inject(OAUTH_PROVIDERS);
  private readonly navigate = inject(OAUTH_NAVIGATE);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');

  available(provider: OAuthProvider): boolean {
    return this.providers.includes(provider);
  }

  start(provider: OAuthProvider): boolean {
    if (
      !this.browser ||
      !Object.hasOwn(endpoints, provider) ||
      !this.available(provider) ||
      !/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(this.base)
    )
      return false;
    // The server owns state/PKCE, callback validation and account linking.
    // No JWT, client secret or arbitrary redirect URL is appended here.
    try {
      this.navigate(`${this.base}/${endpoints[provider]}`);
      return true;
    } catch {
      return false;
    }
  }
}
