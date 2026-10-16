import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ErrorState } from './core/errors/error-state';
import { AuthSession } from './core/auth/auth-session';
import { SessionLifecycle } from './core/auth/session-lifecycle';
import { Router } from '@angular/router';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('42chess');
  protected readonly errors = inject(ErrorState);
  protected readonly session = inject(AuthSession);
  protected readonly lifecycle = inject(SessionLifecycle);
  private readonly router = inject(Router);

  protected signOut(): void {
    this.lifecycle
      .signOut()
      .subscribe({
        error: () =>
          this.session.notice.set(
            'This tab is signed out. Server sign-out could not be confirmed.',
          ),
      });
    void this.router.navigate(['/login']);
  }
}
