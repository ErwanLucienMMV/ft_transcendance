import { Component, DestroyRef, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionLifecycle } from '../../core/auth/session-lifecycle';
import { Router } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { AuthFrame } from '../../shared/auth-frame';
import { RouterLink } from '@angular/router';
import { OAuthAccounts } from './oauth-accounts';

@Component({
  selector: 'app-session-page',
  imports: [AuthFrame, RouterLink, OAuthAccounts],
  templateUrl: './session-page.html',
})
export class SessionPage {
  readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  constructor() {
    inject(SessionLifecycle)
      .refreshUser()
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe({ error: () => {} });
    effect(() => {
      if (!this.session.authenticated())
        void this.router.navigate(['/login'], { queryParams: { returnUrl: '/session' } });
    });
  }
}
