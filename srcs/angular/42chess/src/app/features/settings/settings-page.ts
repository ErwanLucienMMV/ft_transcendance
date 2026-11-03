import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { SessionLifecycle } from '../../core/auth/session-lifecycle';
import { OAuthAccounts } from '../auth/oauth-accounts';
import { AccountApi, SecurityStatus } from './account-api';
import { AppearanceSettings } from './appearance-settings';
import { DataSettings } from './data-settings';
import { PrivacySettings } from './privacy-settings';
import { ProfileSettings } from './profile-settings';
import { SecuritySettings } from './security-settings';

/** Everything about the signed-in account: profile, appearance, privacy, security, sign-in and data. */
@Component({
  selector: 'app-settings-page',
  imports: [
    RouterLink,
    ProfileSettings,
    AppearanceSettings,
    PrivacySettings,
    SecuritySettings,
    OAuthAccounts,
    DataSettings,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  readonly session = inject(AuthSession);
  private readonly account = inject(AccountApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  /** Set after an account was just created through a sign-in provider. */
  readonly welcome = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('welcome') === '1')),
    { initialValue: false },
  );
  readonly security = signal<SecurityStatus | null>(null);
  readonly securityFailed = signal(false);
  /** The account was deleted: the sign-in page is next, with nothing to come back to. */
  private leaving = false;

  constructor() {
    inject(SessionLifecycle)
      .refreshUser()
      .pipe(takeUntilDestroyed())
      .subscribe({ error: () => {} });
    this.loadSecurity();
    effect(() => {
      if (!this.session.authenticated() && !this.leaving)
        void this.router.navigate(['/login'], { queryParams: { returnUrl: '/settings' } });
    });
  }

  leave(): void {
    this.leaving = true;
  }

  loadSecurity(): void {
    this.securityFailed.set(false);
    this.account
      .security()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => this.security.set(status),
        error: () => this.securityFailed.set(true),
      });
  }
}
