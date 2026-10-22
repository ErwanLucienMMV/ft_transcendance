import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { AuthFrame } from '../../shared/auth-frame';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-session-page',
  imports: [AuthFrame, RouterLink],
  templateUrl: './session-page.html',
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
