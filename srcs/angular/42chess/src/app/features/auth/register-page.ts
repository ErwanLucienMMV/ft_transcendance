import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { RegisterCredentials } from './auth-form.models';
import { authFeedback } from './auth-feedback';
import { RouterLink } from '@angular/router';
import { RegisterForm } from './register-form';
import { AuthFrame } from '../../shared/auth-frame';

@Component({
  selector: 'app-register-page',
  imports: [RegisterForm, RouterLink, AuthFrame],
  templateUrl: './register-page.html',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly pending = signal(false);
  readonly error = signal('');
  readonly registered = signal(false);
  submit(credentials: RegisterCredentials): void {
    if (this.pending() || this.registered()) return;
    this.pending.set(true);
    this.error.set('');
    this.auth
      .register(credentials)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => this.registered.set(true),
        error: (error) => this.error.set(authFeedback(error)),
      });
  }
}
