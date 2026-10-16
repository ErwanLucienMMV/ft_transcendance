import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ResendVerification } from './resend-verification';
import { authFeedback } from './auth-feedback';
import { AuthFrame } from '../../shared/auth-frame';

@Component({
  selector: 'app-verify-email-page',
  imports: [RouterLink, ResendVerification, AuthFrame],
  template: `
    <app-auth-frame>
      <h2>Verify your email</h2>
      <p class="auth-intro">One last step before your first move.</p>
      <p role="status">{{ message() }}</p>
      @if (verified()) {
        <a class="button" routerLink="/login">Sign in <span aria-hidden="true">→</span></a>
      }
      <app-resend-verification />
      <p class="auth-switch"><a routerLink="/login">Back to sign in</a></p>
    </app-auth-frame>
  `,
})
export class VerifyEmailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly message = signal('Open the verification link from your email.');
  readonly verified = signal(false);
  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) return;
    this.message.set('Verifying your email…');
    this.auth
      .verifyEmail(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.verified.set(true);
          this.message.set('Your email is verified. You can now sign in.');
        },
        error: (error) => this.message.set(authFeedback(error)),
      });
  }
}
