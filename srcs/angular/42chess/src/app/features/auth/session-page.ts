import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';

@Component({
  selector: 'app-session-page',
  template: `
    <h2>Signed in</h2>
    <p role="status">Welcome, {{ session.user()?.username }}.</p>
    <p>Your session is kept in this tab until it expires or the page is refreshed.</p>
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
