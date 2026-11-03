import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthFrame } from '../../shared/auth-frame';
import { AccountApi } from '../settings/account-api';
import { settingsError } from '../settings/settings-text';
import { AUTH_FIELD_LIMITS } from './auth-form.models';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

/** Asks for a reset link by email. The answer is the same whether the account exists or not. */
@Component({
  selector: 'app-forgot-password-page',
  imports: [TranslocoDirective, AuthFrame, ReactiveFormsModule, RouterLink],
  template: `
    <ng-container *transloco="let t">
      <app-auth-frame>
        <h1>{{ t('auth.forgot.title') }}</h1>
        <p class="auth-intro">{{ t('auth.forgot.intro') }}</p>
        @if (sent()) {
          <p role="status">{{ t('auth.forgot.sent') }}</p>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="pending()">
            <div class="form-field">
              <label for="forgot-email">{{ t('auth.forgot.email') }}</label>
              <input
                id="forgot-email"
                type="email"
                formControlName="email"
                autocomplete="email"
                [placeholder]="t('auth.register.emailPlaceholder')"
                [maxLength]="limits.emailMax"
                [attr.aria-invalid]="invalid()"
                [attr.aria-describedby]="invalid() ? 'forgot-email-error' : null"
              />
              @if (invalid()) {
                <p id="forgot-email-error">{{ t('auth.forgot.emailError') }}</p>
              }
            </div>
            <button type="submit" [disabled]="pending()">
              {{ pending() ? t('common.sending') : t('auth.forgot.submit') }}
            </button>
          </form>
        }
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        <p class="auth-switch">
          {{ t('auth.forgot.remembered') }}
          <a routerLink="/login">{{ t('auth.forgot.back') }}</a>
        </p>
      </app-auth-frame>
    </ng-container>
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
        error: (error: unknown) => this.error.set(settingsError(error, tr('auth.forgot.failed'))),
      });
  }
}
