import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

export interface AuthUser {
  id: string;
  username: string;
  elo: number;
}
export interface AuthTokenResponse {
  accessToken: string;
  user: AuthUser;
}

/** Memory only. JWT decoding controls client expiry; it never verifies identity. */
@Injectable({ providedIn: 'root' })
export class AuthSession {
  private readonly current = signal<AuthTokenResponse | null>(null);
  private timer?: ReturnType<typeof setTimeout>;
  readonly user = computed(() => this.current()?.user ?? null);
  readonly authenticated = computed(() => this.current() !== null);
  readonly notice = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  token(): string | null {
    return this.current()?.accessToken ?? null;
  }

  establish(response: AuthTokenResponse): void {
    const expiresAt = this.expiry(response.accessToken);
    if (!response.user?.id || !response.user.username || expiresAt <= Date.now()) {
      throw new Error('Invalid authentication response.');
    }
    this.clear();
    this.notice.set(null);
    this.current.set(response);
    this.timer = setTimeout(
      () => this.clear('Your session expired. Please sign in again.'),
      Math.min(expiresAt - Date.now(), 2_147_483_647),
    );
  }

  clear(message: string | null = null): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current.set(null);
    this.notice.set(message);
  }

  updateUser(user: AuthUser, expectedToken: string): boolean {
    const current = this.current();
    if (!current || current.accessToken !== expectedToken || user.id !== current.user.id)
      return false;
    this.current.set({ ...current, user: { id: user.id, username: user.username, elo: user.elo } });
    return true;
  }

  private expiry(token: string): number {
    try {
      const part = token.split('.')[1];
      const value: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      const exp = (value as { exp?: unknown })?.exp;
      return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0;
    } catch {
      return 0;
    }
  }
}
