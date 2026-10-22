import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { safeReturnUrl } from '../../core/auth/auth.interceptor';
import { LoginCredentials } from './auth-form.models';
import { authFeedback } from './auth-feedback';
import { ResendVerification } from './resend-verification';
import { LoginForm } from './login-form';
import { AuthFrame } from '../../shared/auth-frame';

@Component({
  selector: 'app-login-page',
  imports: [LoginForm, RouterLink, ResendVerification, AuthFrame],
  templateUrl: './login-page.html',
})
export class LoginPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly pending = signal(false);
  readonly error = signal('');
  submit(credentials: LoginCredentials): void {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.auth
      .login(credentials)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => {
          const returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
          if (this.auth.needsTwoFactor())
            void this.router.navigate(['/two-factor'], { queryParams: { returnUrl } });
          else void this.router.navigateByUrl(returnUrl);
        },
        error: (error) => this.error.set(authFeedback(error)),
      });
  }
}
