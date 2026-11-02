import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthFrame } from '../../shared/auth-frame';
import { AccountApi } from '../settings/account-api';
import { settingsError } from '../settings/settings-text';
import { AUTH_FIELD_LIMITS } from './auth-form.models';

/** Asks for a reset link by email. The answer is the same whether the account exists or not. */
@Component({
  selector: 'app-forgot-password-page',
  imports: [AuthFrame, ReactiveFormsModule, RouterLink],
  template: `
    <app-auth-frame>
      <h2>Forgot your password?</h2>
      <p class="auth-intro">
        Enter the email address of your account. We will send you a link to choose a new password.
      </p>
      @if (sent()) {
        <p role="status">
          If an account with a password uses this address, a link is on its way. It works for 30
          minutes. Check your spam folder if nothing arrives.
        </p>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="pending()">
          <div class="form-field">
            <label for="forgot-email">Email address</label>
            <input
              id="forgot-email"
              type="email"
              formControlName="email"
              autocomplete="email"
              placeholder="you@example.com"
              [maxLength]="limits.emailMax"
              [attr.aria-invalid]="invalid()"
              [attr.aria-describedby]="invalid() ? 'forgot-email-error' : null"
            />
            @if (invalid()) {
              <p id="forgot-email-error">Enter a valid email address.</p>
            }
          </div>
          <button type="submit" [disabled]="pending()">
            {{ pending() ? 'Sending…' : 'Send the link' }}
          </button>
        </form>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <p class="auth-switch">Remembered it? <a routerLink="/login">Back to sign in</a></p>
    </app-auth-frame>
  `,
})
export class ForgotPasswordPage {
  private readonly account = inject(AccountApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly limits = AUTH_FIELD_LIMITS;
  readonly form = inject(FormBuilder).nonNullable.group({
    email: [
      '',
      [Validators.required, Validators.email, Validators.maxLength(AUTH_FIELD_LIMITS.emailMax)],
    ],
  });
  readonly pending = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');

  invalid(): boolean {
    const control = this.form.controls.email;
    return control.invalid && (control.touched || control.dirty);
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.account
      .forgotPassword(this.form.getRawValue().email)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => this.sent.set(true),
        error: (error: unknown) =>
          this.error.set(settingsError(error, 'The link could not be sent. Try again.')),
      });
  }
}
