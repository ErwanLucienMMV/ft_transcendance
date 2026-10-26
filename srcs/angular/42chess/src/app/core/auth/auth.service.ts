import { inject, Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { LoginCredentials, RegisterCredentials } from '../../features/auth/auth-form.models';
import { AuthSession, AuthTokenResponse, AuthUser } from './auth-session';

export interface TwoFactorChallenge {
  requires2fa: true;
  challengeToken: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  readonly session = inject(AuthSession);
  private readonly challenge = signal<string | null>(null);
  readonly needsTwoFactor = this.challenge.asReadonly();

  register(credentials: RegisterCredentials) {
    return this.api.post<{ user: AuthUser }>('auth/register', credentials);
  }

  login(credentials: LoginCredentials) {
    this.cancelChallenge();
    this.session.clear();
    return this.api.post<AuthTokenResponse | TwoFactorChallenge>('auth/login', credentials).pipe(
      tap((response) => {
        this.acceptSignIn(response);
      }),
    );
  }

  verifyTwoFactor(code: string) {
    const challengeToken = this.challenge();
    if (!challengeToken) throw new Error('Sign in again before entering a code.');
    return this.api.post<AuthTokenResponse>('auth/2fa/verify', { challengeToken, code }).pipe(
      tap((response) => {
        this.session.establish(response);
        this.cancelChallenge();
      }),
    );
  }

  verifyEmail(token: string) {
    return this.api.post<{ user: AuthUser }>('auth/verify-email', { token });
  }
  resendVerification(email: string) {
    return this.api.post<void>('auth/resend-verification', { email });
  }
  cancelChallenge(): void {
    this.challenge.set(null);
  }

  acceptSignIn(response: AuthTokenResponse | TwoFactorChallenge): void {
    this.cancelChallenge();
    this.session.clear();
    if ('requires2fa' in response && response.requires2fa) {
      if (!response.challengeToken) throw new Error('Invalid authentication response.');
      this.challenge.set(response.challengeToken);
    } else this.session.establish(response as AuthTokenResponse);
  }
}
