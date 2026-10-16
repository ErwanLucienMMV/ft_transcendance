import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { AuthFrame } from '../../shared/auth-frame';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-session-page',
  imports: [AuthFrame, RouterLink],
  template: `
    <app-auth-frame>
      <h2>Signed in</h2>
      <p class="auth-intro">Good to have you at the board.</p>
      <p role="status">Welcome, {{ session.user()?.username }}.</p>
      <p class="auth-intro">
        Your session is kept in this tab until it expires or the page is refreshed.
      </p>
      <a class="button secondary" routerLink="/">Return home <span aria-hidden="true">→</span></a>
    </app-auth-frame>
  `,
})
export class SessionPage {
  readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  constructor() {
    effect(() => {
      if (!this.session.authenticated())
        void this.router.navigate(['/login'], { queryParams: { returnUrl: '/session' } });
    });
  }
}
