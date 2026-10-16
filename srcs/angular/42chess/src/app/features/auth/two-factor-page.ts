import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { safeReturnUrl } from '../../core/auth/auth.interceptor';
import { authFeedback } from './auth-feedback';

@Component({
  selector: 'app-two-factor-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <h2>Two-factor authentication</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="pending()">
      <label for="totp-code">Authenticator code</label>
      <input
        id="totp-code"
        formControlName="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        required
      />
      @if (form.invalid && form.touched) {
        <p role="alert">Enter the six-digit code.</p>
      }
      <button type="submit" [disabled]="pending()">Verify code</button>
    </form>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    <a routerLink="/login" (click)="auth.cancelChallenge()">Start sign-in again</a>
  `,
})
export class TwoFactorPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  readonly pending = signal(false);
  readonly error = signal('');
  ngOnInit(): void {
    if (!this.auth.needsTwoFactor()) void this.router.navigate(['/login']);
  }
  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.pending() || !this.auth.needsTwoFactor()) return;
    this.pending.set(true);
    this.error.set('');
    this.auth
      .verifyTwoFactor(this.form.getRawValue().code)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () =>
          void this.router.navigateByUrl(
            safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')),
          ),
        error: (error) => this.error.set(authFeedback(error)),
      });
  }
}
