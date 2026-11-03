import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthFrame } from '../../shared/auth-frame';
import { AccountApi } from '../settings/account-api';
import { settingsError } from '../settings/settings-text';
import { AUTH_FIELD_LIMITS, backendLengthValidator } from './auth-form.models';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

const RESET_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function samePasswords(group: AbstractControl): ValidationErrors | null {
  const { password, confirmPassword } = group.value as Record<string, string>;
  return confirmPassword && password !== confirmPassword ? { mismatch: true } : null;
}

/** Opened from the emailed link: `/reset-password?token=…`. */
@Component({
  selector: 'app-reset-password-page',
  imports: [TranslocoDirective, AuthFrame, ReactiveFormsModule, RouterLink],
  template: `
    <ng-container *transloco="let t">
      <app-auth-frame>
        <h1>{{ t('auth.reset.title') }}</h1>
        @if (done()) {
          <p role="status">{{ t('auth.reset.done') }}</p>
          <a class="button" routerLink="/login">{{ t('auth.reset.signIn') }}</a>
        } @else if (!token) {
          <p role="alert">{{ t('auth.reset.incomplete') }}</p>
          <a class="button secondary" routerLink="/forgot-password">{{
            t('auth.reset.newLink')
          }}</a>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="pending()">
            <div class="form-field">
              <label for="reset-password">{{ t('auth.reset.password') }}</label>
              <input
                id="reset-password"
                type="password"
                formControlName="password"
                autocomplete="new-password"
                aria-describedby="reset-password-help"
                [attr.aria-invalid]="invalid('password')"
              />
              <p id="reset-password-help">
                {{
                  t('auth.reset.passwordHelp', { min: limits.passwordMin, max: limits.passwordMax })
                }}
              </p>
            </div>
            <div class="form-field">
              <label for="reset-confirm-password">{{ t('auth.reset.confirm') }}</label>
              <input
                id="reset-confirm-password"
                type="password"
                formControlName="confirmPassword"
                autocomplete="new-password"
                [attr.aria-invalid]="mismatch()"
                [attr.aria-describedby]="mismatch() ? 'reset-confirm-error' : null"
              />
              @if (mismatch()) {
                <p id="reset-confirm-error">{{ t('auth.reset.mismatch') }}</p>
              }
            </div>
            <button type="submit" [disabled]="pending()">
              {{ pending() ? t('common.saving') : t('auth.reset.submit') }}
            </button>
          </form>
          @if (error()) {
            <p role="alert">{{ error() }}</p>
            @if (expired()) {
              <a class="button secondary" routerLink="/forgot-password">{{
                t('auth.reset.newLink')
              }}</a>
            }
          }
        }
      </app-auth-frame>
    </ng-container>
  `,
})
export class ResetPasswordPage {
  private readonly account = inject(AccountApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly limits = AUTH_FIELD_LIMITS;
  private readonly raw = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  readonly token = this.raw && RESET_TOKEN.test(this.raw) ? this.raw : null;
  readonly form = inject(FormBuilder).nonNullable.group(
    {
      password: [
        '',
        [
          Validators.required,
          backendLengthValidator(AUTH_FIELD_LIMITS.passwordMin, AUTH_FIELD_LIMITS.passwordMax),
        ],
      ],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: samePasswords },
  );
  readonly pending = signal(false);
  readonly done = signal(false);
  readonly error = signal('');
  readonly expired = signal(false);

  invalid(name: 'password'): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }

  mismatch(): boolean {
    const confirm = this.form.controls.confirmPassword;
    return this.form.hasError('mismatch') && (confirm.touched || confirm.dirty);
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (!this.token || this.pending()) return;
    if (this.form.invalid) {
      this.error.set(
        this.mismatch()
          ? tr('auth.reset.mismatch')
          : tr('auth.reset.length', {
              min: AUTH_FIELD_LIMITS.passwordMin,
              max: AUTH_FIELD_LIMITS.passwordMax,
            }),
      );
      return;
    }
    this.pending.set(true);
    this.error.set('');
    this.expired.set(false);
    this.account
      .resetPassword(this.token, this.form.getRawValue().password)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => this.done.set(true),
        error: (error: unknown) => {
          this.error.set(settingsError(error, tr('auth.reset.failed')));
          this.expired.set((error as { code?: string } | null)?.code === 'INVALID_RESET_TOKEN');
        },
      });
  }
}
