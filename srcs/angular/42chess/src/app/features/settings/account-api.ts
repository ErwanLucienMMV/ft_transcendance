import { HttpClient, HttpEvent, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-base-url';
import { ApiClient } from '../../core/api/api-client';
import { handledErrors } from '../../core/api/api-error.interceptor';
import { AuthSession } from '../../core/auth/auth-session';
import { CurrentUser, UserPreferences } from '../../core/auth/session-lifecycle';

/** What the security section shows. `recoveryCodesLeft` is null while 2FA is off. */
export interface SecurityStatus {
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  recoveryCodesLeft: number | null;
}

/** A secret waiting for its first code: the QR code encodes `otpauthUrl`. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrSvg: string;
}

export interface DeleteAccountRequest {
  /** The username, typed again. */
  confirmation: string;
  password?: string;
  code?: string;
}

/** Same limits as the API (users/avatar-storage.ts). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The settings page forms explain a mail outage themselves. */
const MAIL_ERRORS = handledErrors('EMAIL_SERVICE_UNAVAILABLE');

/**
 * The signed-in account's own settings. Requests under `auth/` carry the access token
 * themselves: the auth interceptor leaves that prefix alone.
 */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSession);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');

  me(): Observable<CurrentUser> {
    return this.api.get('users/me');
  }

  rename(username: string): Observable<CurrentUser> {
    return this.api.patch('users/me', { username });
  }

  /** Only the keys given change. */
  updatePreferences(preferences: Partial<UserPreferences>): Observable<CurrentUser> {
    return this.api.patch('users/me', { preferences });
  }

  /** Reports the upload progress, then the updated account. */
  uploadAvatar(file: Blob): Observable<HttpEvent<CurrentUser>> {
    const form = new FormData();
    form.append('avatar', file);
    return this.http.post<CurrentUser>(`${this.base}/users/me/avatar`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  removeAvatar(): Observable<CurrentUser> {
    return this.api.delete('users/me/avatar');
  }

  security(): Observable<SecurityStatus> {
    return this.api.get('auth/security', { headers: this.bearer() });
  }

  setupTwoFactor(): Observable<TwoFactorSetup> {
    return this.api.post('auth/2fa/setup', {}, { headers: this.bearer() });
  }

  enableTwoFactor(code: string): Observable<{ recoveryCodes: string[] }> {
    return this.api.post('auth/2fa/enable', { code }, { headers: this.bearer() });
  }

  disableTwoFactor(code: string): Observable<void> {
    return this.api.post('auth/2fa/disable', { code }, { headers: this.bearer() });
  }

  regenerateRecoveryCodes(code: string): Observable<{ recoveryCodes: string[] }> {
    return this.api.post('auth/2fa/recovery-codes', { code }, { headers: this.bearer() });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.api.post(
      'auth/password',
      { currentPassword, newPassword },
      { headers: this.bearer() },
    );
  }

  forgotPassword(email: string): Observable<void> {
    return this.api.post('auth/forgot-password', { email }, MAIL_ERRORS);
  }

  resetPassword(token: string, password: string): Observable<void> {
    return this.api.post('auth/reset-password', { token, password });
  }

  /** The JSON file, with the name the server suggests. */
  exportData(): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}/users/me/export`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  deleteAccount(request: DeleteAccountRequest): Observable<void> {
    return this.http.delete<void>(`${this.base}/users/me`, { body: request });
  }

  private bearer(): Record<string, string> {
    const token = this.session.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

/** The file name from a Content-Disposition header, or a default one. */
export function downloadName(disposition: string | null, fallback: string): string {
  const name = /filename="([^"]+)"/.exec(disposition ?? '')?.[1];
  return name && /^[\w.-]+$/.test(name) ? name : fallback;
}
