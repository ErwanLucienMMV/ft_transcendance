import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { finalize, Observable } from 'rxjs';
import { AUTH_FIELD_LIMITS, backendLengthValidator } from '../auth/auth-form.models';
import { SECOND_FACTOR_CODE } from '../auth/second-factor-code';
import { AccountApi, SecurityStatus } from './account-api';
import { settingsError } from './settings-text';

function samePasswords(group: AbstractControl): ValidationErrors | null {
  const value = group.value as { newPassword: string; confirmPassword: string };
  return value.confirmPassword && value.newPassword !== value.confirmPassword
    ? { mismatch: true }
    : null;
}

/** The QR code as an image the page can show; the API draws it as SVG. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Password change, and two-factor authentication with its recovery codes. */
@Component({
  selector: 'app-security-settings',
  imports: [ReactiveFormsModule],
  template: `
    <section class="card settings-section" aria-labelledby="security-settings-title">
      <h3 id="security-settings-title" class="section-title">Security</h3>
      @if (status(); as current) {
        <div class="subsection">
          <h4>Password</h4>
          @if (current.hasPassword) {
            <form [formGroup]="password" (ngSubmit)="changePassword()" novalidate>
              <div class="form-field">
                <label for="current-password">Current password</label>
                <input
                  id="current-password"
                  type="password"
                  formControlName="currentPassword"
                  autocomplete="current-password"
                />
              </div>
              <div class="form-field">
                <label for="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  formControlName="newPassword"
                  autocomplete="new-password"
                  aria-describedby="new-password-help"
                  [attr.aria-invalid]="invalid('newPassword')"
                />
                <p id="new-password-help">
                  {{ limits.passwordMin }}–{{ limits.passwordMax }} characters.
                </p>
              </div>
              <div class="form-field">
                <label for="confirm-new-password">Confirm the new password</label>
                <input
                  id="confirm-new-password"
                  type="password"
                  formControlName="confirmPassword"
                  autocomplete="new-password"
                  [attr.aria-invalid]="mismatch()"
                />
                @if (mismatch()) {
                  <p id="confirm-new-password-error">Enter the same password in both fields.</p>
                }
              </div>
              <div class="row">
                <button type="submit" [disabled]="busy() === 'password'">
                  {{ busy() === 'password' ? 'Saving…' : 'Change password' }}
                </button>
              </div>
              @if (passwordMessage(); as message) {
                <p
                  [class]="message.ok ? 'saved' : 'field-error'"
                  [attr.role]="message.ok ? 'status' : 'alert'"
                >
                  {{ message.text }}
                </p>
              }
            </form>
          } @else {
            <p class="muted">
              You sign in with an external account, so this account has no password to change.
            </p>
          }
        </div>

        <div class="subsection">
          <h4>Two-factor authentication</h4>
          @if (codes(); as list) {
            <div class="recovery" role="region" aria-label="Recovery codes">
              <p>
                <strong>Save these recovery codes now.</strong> Each one lets you sign in once if
                you lose your phone. They will not be shown again.
              </p>
              <ul class="codes">
                @for (code of list; track code) {
                  <li>
                    <code>{{ code }}</code>
                  </li>
                }
              </ul>
              <div class="row">
                <button type="button" class="secondary" (click)="copyCodes(list)">Copy</button>
                <button type="button" class="secondary" (click)="downloadCodes(list)">
                  Download
                </button>
                <button type="button" (click)="codes.set(null)">I saved them</button>
              </div>
              @if (copied()) {
                <p class="saved" role="status">Copied to the clipboard.</p>
              }
            </div>
          } @else if (current.twoFactorEnabled) {
            <p>
              <span class="badge on">On</span>
              Signing in asks for a code from your authenticator app.
              @if (current.recoveryCodesLeft !== null) {
                {{ current.recoveryCodesLeft }} recovery
                {{ current.recoveryCodesLeft === 1 ? 'code' : 'codes' }} left.
              }
            </p>
            <form class="inline-form" (submit)="$event.preventDefault()" novalidate>
              <div class="form-field">
                <label for="manage-2fa-code">Code from your app, or a recovery code</label>
                <input
                  id="manage-2fa-code"
                  [formControl]="manageCode"
                  autocomplete="one-time-code"
                  maxlength="11"
                  spellcheck="false"
                />
              </div>
              <div class="row">
                <button
                  type="button"
                  class="secondary"
                  [disabled]="busy() !== null"
                  (click)="regenerate()"
                >
                  New recovery codes
                </button>
                <button
                  type="button"
                  class="danger"
                  [disabled]="busy() !== null"
                  (click)="disable()"
                >
                  Turn off
                </button>
              </div>
            </form>
          } @else if (setup(); as pending) {
            <ol class="setup-steps">
              <li>
                Scan this QR code with an authenticator app (Google Authenticator, Aegis,
                1Password…).
                <img
                  class="qr"
                  [src]="pending.qr"
                  alt="QR code to add 42 Chess to your authenticator app"
                />
                <details>
                  <summary>Cannot scan it?</summary>
                  <p>
                    Enter this key in the app instead:
                    <code class="secret">{{ pending.secret }}</code>
                  </p>
                </details>
              </li>
              <li>
                <form class="inline-form" (submit)="$event.preventDefault(); enable()" novalidate>
                  <div class="form-field">
                    <label for="enable-2fa-code">Enter the 6-digit code the app shows</label>
                    <input
                      id="enable-2fa-code"
                      [formControl]="enableCode"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      maxlength="6"
                    />
                  </div>
                  <div class="row">
                    <button type="submit" [disabled]="busy() !== null">Turn on</button>
                    <button type="button" class="ghost" (click)="setup.set(null)">Cancel</button>
                  </div>
                </form>
              </li>
            </ol>
          } @else {
            <p class="muted">
              <span class="badge">Off</span>
              Add a second step to signing in: a code from an app on your phone.
            </p>
            <div class="row">
              <button
                type="button"
                class="secondary"
                [disabled]="busy() !== null"
                (click)="start()"
              >
                Set up two-factor authentication
              </button>
            </div>
          }
          @if (twoFactorMessage(); as message) {
            <p
              [class]="message.ok ? 'saved' : 'field-error'"
              [attr.role]="message.ok ? 'status' : 'alert'"
            >
              {{ message.text }}
            </p>
          }
        </div>
      } @else if (failed()) {
        <p class="field-error" role="alert">Your security settings could not be loaded.</p>
      } @else {
        <p class="muted" role="status">Loading…</p>
      }
    </section>
  `,
})
export class SecuritySettings {
  private readonly account = inject(AccountApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  readonly status = input<SecurityStatus | null>(null);
  readonly failed = input(false);
  /** The status changed: the page reads it again. */
  readonly changed = output<void>();
  readonly limits = AUTH_FIELD_LIMITS;

  private readonly forms = inject(FormBuilder).nonNullable;
  readonly password = this.forms.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: [
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
  readonly enableCode = this.forms.control('', [
    Validators.required,
    Validators.pattern(/^\d{6}$/),
  ]);
  readonly manageCode = this.forms.control('', [
    Validators.required,
    Validators.pattern(SECOND_FACTOR_CODE),
  ]);

  readonly busy = signal<'password' | 'two-factor' | null>(null);
  readonly passwordMessage = signal<{ ok: boolean; text: string } | null>(null);
  readonly twoFactorMessage = signal<{ ok: boolean; text: string } | null>(null);
  readonly setup = signal<{ secret: string; qr: SafeUrl } | null>(null);
  readonly codes = signal<string[] | null>(null);
  readonly copied = signal(false);

  invalid(name: 'newPassword'): boolean {
    const control = this.password.controls[name];
    return control.invalid && control.dirty;
  }

  mismatch(): boolean {
    return this.password.hasError('mismatch') && this.password.controls.confirmPassword.dirty;
  }

  changePassword(): void {
    this.password.markAllAsDirty();
    this.passwordMessage.set(null);
    if (this.password.invalid) {
      this.passwordMessage.set({
        ok: false,
        text: this.mismatch()
          ? 'Enter the same new password in both fields.'
          : `Fill in every field. The new password needs ${AUTH_FIELD_LIMITS.passwordMin} to ${AUTH_FIELD_LIMITS.passwordMax} characters.`,
      });
      return;
    }
    if (this.busy()) return;
    const { currentPassword, newPassword } = this.password.getRawValue();
    this.run('password', this.account.changePassword(currentPassword, newPassword), {
      next: () => {
        this.password.reset();
        this.passwordMessage.set({
          ok: true,
          text: 'Your password was changed. Your other devices were signed out.',
        });
      },
      error: (error) =>
        this.passwordMessage.set({
          ok: false,
          text: settingsError(error, 'Your password could not be changed. Try again.', {
            INVALID_PASSWORD: 'The current password is not correct.',
          }),
        }),
    });
  }

  start(): void {
    this.twoFactorMessage.set(null);
    this.run('two-factor', this.account.setupTwoFactor(), {
      next: (setup) => {
        this.enableCode.reset();
        this.setup.set({
          secret: setup.secret,
          // The SVG comes from our API and is shown as an image, never inserted as markup.
          qr: this.sanitizer.bypassSecurityTrustUrl(svgDataUrl(setup.qrSvg)),
        });
      },
      error: (error) => this.twoFactorFailed(error),
    });
  }

  enable(): void {
    this.twoFactorMessage.set(null);
    if (this.enableCode.invalid) {
      this.twoFactorMessage.set({ ok: false, text: 'Enter the 6-digit code from the app.' });
      return;
    }
    this.run('two-factor', this.account.enableTwoFactor(this.enableCode.value), {
      next: ({ recoveryCodes }) => {
        this.setup.set(null);
        this.codes.set(recoveryCodes);
        this.twoFactorMessage.set({ ok: true, text: 'Two-factor authentication is on.' });
        this.changed.emit();
      },
      error: (error) => this.twoFactorFailed(error),
    });
  }

  regenerate(): void {
    const code = this.checkedCode();
    if (!code) return;
    this.run('two-factor', this.account.regenerateRecoveryCodes(code), {
      next: ({ recoveryCodes }) => {
        this.manageCode.reset();
        this.codes.set(recoveryCodes);
        this.twoFactorMessage.set({
          ok: true,
          text: 'New recovery codes were made. The old ones no longer work.',
        });
        this.changed.emit();
      },
      error: (error) => this.twoFactorFailed(error),
    });
  }

  disable(): void {
    const code = this.checkedCode();
    if (!code) return;
    this.run('two-factor', this.account.disableTwoFactor(code), {
      next: () => {
        this.manageCode.reset();
        this.twoFactorMessage.set({ ok: true, text: 'Two-factor authentication is off.' });
        this.changed.emit();
      },
      error: (error) => this.twoFactorFailed(error),
    });
  }

  copyCodes(codes: string[]): void {
    void navigator.clipboard
      ?.writeText(codes.join('\n'))
      .then(() => this.copied.set(true))
      .catch(() => this.copied.set(false));
  }

  downloadCodes(codes: string[]): void {
    const url = URL.createObjectURL(
      new Blob([`42 Chess recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '42chess-recovery-codes.txt';
    link.click();
    // Some browsers start the download after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private checkedCode(): string | null {
    this.twoFactorMessage.set(null);
    if (this.manageCode.invalid) {
      this.twoFactorMessage.set({
        ok: false,
        text: 'Enter the 6-digit code from your app, or one of your recovery codes.',
      });
      return null;
    }
    return this.manageCode.value.trim();
  }

  private twoFactorFailed(error: unknown): void {
    this.twoFactorMessage.set({
      ok: false,
      text: settingsError(error, 'This could not be done. Try again.'),
    });
  }

  private run<T>(
    kind: 'password' | 'two-factor',
    request: Observable<T>,
    handlers: { next: (value: T) => void; error: (error: unknown) => void },
  ): void {
    if (this.busy()) return;
    this.busy.set(kind);
    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(null)),
      )
      .subscribe(handlers);
  }
}
