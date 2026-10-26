import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionLifecycle } from './core/auth/session-lifecycle';
import { AuthSession } from './core/auth/auth-session';
import { ErrorState } from './core/errors/error-state';

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
  private readonly lifecycle = inject(SessionLifecycle);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  signOut(): void {
    const leave = () => {
      if (!this.session.authenticated()) void this.router.navigate(['/login']);
    };
    this.lifecycle
      .signOut()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: leave, error: leave });
  }
}
