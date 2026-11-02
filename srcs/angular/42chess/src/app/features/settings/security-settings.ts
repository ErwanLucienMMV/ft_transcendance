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
import { Spinner } from '../../shared/ui/spinner';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr, trCount } from '../../core/i18n/i18n';

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
  imports: [TranslocoDirective, Spinner, ReactiveFormsModule],
  template: `
    <ng-container *transloco="let t">
      <section class="card settings-section" aria-labelledby="security-settings-title">
        <h2 id="security-settings-title" class="section-title">
          {{ t('settings.security.title') }}
        </h2>
        @if (status(); as current) {
          <div class="subsection">
            <h3>{{ t('settings.security.password') }}</h3>
            @if (current.hasPassword) {
              <form [formGroup]="password" (ngSubmit)="changePassword()" novalidate>
                <div class="form-field">
                  <label for="current-password">{{ t('settings.security.current') }}</label>
                  <input
                    id="current-password"
                    type="password"
                    formControlName="currentPassword"
                    autocomplete="current-password"
                  />
                </div>
                <div class="form-field">
                  <label for="new-password">{{ t('settings.security.new') }}</label>
                  <input
                    id="new-password"
                    type="password"
                    formControlName="newPassword"
                    autocomplete="new-password"
                    aria-describedby="new-password-help"
                    [attr.aria-invalid]="invalid('newPassword')"
                  />
                  <p id="new-password-help">
                    {{
                      t('settings.security.length', {
                        min: limits.passwordMin,
                        max: limits.passwordMax,
                      })
                    }}
                  </p>
                </div>
                <div class="form-field">
                  <label for="confirm-new-password">{{ t('settings.security.confirm') }}</label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    formControlName="confirmPassword"
                    autocomplete="new-password"
                    [attr.aria-invalid]="mismatch()"
                  />
                  @if (mismatch()) {
                    <p id="confirm-new-password-error">{{ t('settings.security.mismatch') }}</p>
                  }
                </div>
                <div class="row">
                  <button type="submit" [disabled]="busy() === 'password'">
                    {{ busy() === 'password' ? t('common.saving') : t('settings.security.change') }}
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
              <p class="muted">{{ t('settings.security.external') }}</p>
            }
          </div>

          <div class="subsection">
            <h3>{{ t('settings.security.twoFactor') }}</h3>
            @if (codes(); as list) {
              <div
                class="recovery"
                role="region"
                [attr.aria-label]="t('settings.security.recoveryCodes')"
              >
                <p>
                  <strong>{{ t('settings.security.saveCodes') }}</strong>
                  {{ t('settings.security.saveCodesHelp') }}
                </p>
                <ul class="codes">
                  @for (code of list; track code) {
                    <li>
                      <code>{{ code }}</code>
                    </li>
                  }
                </ul>
                <div class="row">
                  <button type="button" class="secondary" (click)="copyCodes(list)">
                    {{ t('settings.security.copy') }}
                  </button>
                  <button type="button" class="secondary" (click)="downloadCodes(list)">
                    {{ t('settings.security.download') }}
                  </button>
                  <button type="button" (click)="codes.set(null)">
                    {{ t('settings.security.saved') }}
                  </button>
                </div>
                @if (copied()) {
                  <p class="saved" role="status">{{ t('settings.security.copied') }}</p>
                }
              </div>
            } @else if (current.twoFactorEnabled) {
              <p>
                <span class="badge on">{{ t('settings.security.on') }}</span>
                {{ t('settings.security.onHelp') }}
                @if (current.recoveryCodesLeft !== null) {
                  {{ codesLeft(current.recoveryCodesLeft) }}
                }
              </p>
              <form class="inline-form" (submit)="$event.preventDefault()" novalidate>
                <div class="form-field">
                  <label for="manage-2fa-code">{{ t('settings.data.code') }}</label>
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
                    {{ t('settings.security.newCodes') }}
                  </button>
                  <button
                    type="button"
                    class="danger"
                    [disabled]="busy() !== null"
                    (click)="disable()"
                  >
                    {{ t('settings.security.turnOff') }}
                  </button>
                </div>
              </form>
            } @else if (setup(); as pending) {
              <ol class="setup-steps">
                <li>
                  {{ t('settings.security.scan') }}
                  <img class="qr" [src]="pending.qr" [alt]="t('settings.security.qr')" />
                  <details>
                    <summary>{{ t('settings.security.cannotScan') }}</summary>
                    <p>
                      {{ t('settings.security.enterKey') }}
                      <code class="secret">{{ pending.secret }}</code>
                    </p>
                  </details>
                </li>
                <li>
                  <form class="inline-form" (submit)="$event.preventDefault(); enable()" novalidate>
                    <div class="form-field">
                      <label for="enable-2fa-code">{{ t('settings.security.enterCode') }}</label>
                      <input
                        id="enable-2fa-code"
                        [formControl]="enableCode"
                        inputmode="numeric"
                        autocomplete="one-time-code"
                        maxlength="6"
                      />
                    </div>
                    <div class="row">
                      <button type="submit" [disabled]="busy() !== null">
                        {{ t('settings.security.turnOn') }}
                      </button>
                      <button type="button" class="ghost" (click)="setup.set(null)">
                        {{ t('common.cancel') }}
                      </button>
                    </div>
                  </form>
                </li>
              </ol>
            } @else {
              <p class="muted">
                <span class="badge">{{ t('settings.security.off') }}</span>
                {{ t('settings.security.offHelp') }}
              </p>
              <div class="row">
                <button
                  type="button"
                  class="secondary"
                  [disabled]="busy() !== null"
                  (click)="start()"
                >
                  {{ t('settings.security.setUp') }}
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
          <p class="field-error" role="alert">{{ t('settings.security.loadFailed') }}</p>
        } @else {
          <app-spinner [showLabel]="true" />
        }
      </section>
    </ng-container>
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
          ? tr('settings.security.mismatchNew')
          : tr('settings.security.fillIn', {
              min: AUTH_FIELD_LIMITS.passwordMin,
              max: AUTH_FIELD_LIMITS.passwordMax,
            }),
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
          text: tr('settings.security.changed'),
        });
      },
      error: (error) =>
        this.passwordMessage.set({
          ok: false,
          text: settingsError(error, tr('settings.security.changeFailed'), {
            INVALID_PASSWORD: tr('settings.security.wrongCurrent'),
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
      this.twoFactorMessage.set({ ok: false, text: tr('settings.security.codeNeeded') });
      return;
    }
    this.run('two-factor', this.account.enableTwoFactor(this.enableCode.value), {
      next: ({ recoveryCodes }) => {
        this.setup.set(null);
        this.codes.set(recoveryCodes);
        this.twoFactorMessage.set({ ok: true, text: tr('settings.security.nowOn') });
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
          text: tr('settings.security.regenerated'),
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
        this.twoFactorMessage.set({ ok: true, text: tr('settings.security.nowOff') });
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
      new Blob([`${tr('settings.security.fileTitle')}\n\n${codes.join('\n')}\n`], {
        type: 'text/plain',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '42chess-recovery-codes.txt';
    link.click();
    // Some browsers start the download after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  codesLeft(count: number): string {
    return trCount('settings.security.codesLeft', count);
  }

  private checkedCode(): string | null {
    this.twoFactorMessage.set(null);
    if (this.manageCode.invalid) {
      this.twoFactorMessage.set({
        ok: false,
        text: tr('settings.security.manageCodeNeeded'),
      });
      return null;
    }
    return this.manageCode.value.trim();
  }

  private twoFactorFailed(error: unknown): void {
    this.twoFactorMessage.set({
      ok: false,
      text: settingsError(error, tr('settings.security.failed')),
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
