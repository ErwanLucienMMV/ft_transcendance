import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { AccountApi, DeleteAccountRequest, downloadName, SecurityStatus } from './account-api';
import { SECOND_FACTOR_CODE } from '../auth/second-factor-code';
import { settingsError } from './settings-text';

/** A copy of the account's data, and the deletion of the account. */
@Component({
  selector: 'app-data-settings',
  imports: [ReactiveFormsModule],
  template: `
    <section class="card settings-section" aria-labelledby="data-settings-title">
      <h2 id="data-settings-title" class="section-title">Your data</h2>
      <div class="subsection">
        <h3>Download your data</h3>
        <p class="muted">
          A JSON file with your profile, games, ratings, friends, messages and puzzle results.
        </p>
        <div class="row">
          <button type="button" class="secondary" [disabled]="exporting()" (click)="exportData()">
            {{ exporting() ? 'Preparing…' : 'Download my data' }}
          </button>
        </div>
        @if (exportMessage(); as message) {
          <p
            [class]="message.ok ? 'saved' : 'field-error'"
            [attr.role]="message.ok ? 'status' : 'alert'"
          >
            {{ message.text }}
          </p>
        }
      </div>

      <div class="subsection danger-zone">
        <h3>Delete your account</h3>
        <p class="muted">
          Your profile, friends, messages and sign-in methods are erased. Finished games stay in
          your opponents' history, under the name “Deleted player”. This cannot be undone.
        </p>
        @if (!confirming()) {
          <div class="row">
            <button type="button" class="secondary" (click)="confirming.set(true)">
              Delete my account…
            </button>
          </div>
        } @else {
          <form [formGroup]="form" (ngSubmit)="deleteAccount()" novalidate>
            <div class="form-field">
              <label for="delete-confirmation"
                >Type your username, {{ username() }}, to confirm</label
              >
              <input
                id="delete-confirmation"
                formControlName="confirmation"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            @if (status()?.hasPassword) {
              <div class="form-field">
                <label for="delete-password">Password</label>
                <input
                  id="delete-password"
                  type="password"
                  formControlName="password"
                  autocomplete="current-password"
                />
              </div>
            }
            @if (status()?.twoFactorEnabled) {
              <div class="form-field">
                <label for="delete-code">Code from your app, or a recovery code</label>
                <input
                  id="delete-code"
                  formControlName="code"
                  autocomplete="one-time-code"
                  maxlength="11"
                  spellcheck="false"
                />
              </div>
            }
            <div class="row">
              <button type="submit" class="danger" [disabled]="deleting() || !ready()">
                {{ deleting() ? 'Deleting…' : 'Delete my account for good' }}
              </button>
              <button type="button" class="ghost" [disabled]="deleting()" (click)="cancel()">
                Cancel
              </button>
            </div>
            @if (deleteError(); as message) {
              <p class="field-error" role="alert">{{ message }}</p>
            }
          </form>
        }
      </div>
    </section>
  `,
})
export class DataSettings {
  private readonly account = inject(AccountApi);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly status = input<SecurityStatus | null>(null);
  /** Emitted just before this tab signs out, once the account is gone. */
  readonly deleted = output<void>();
  readonly username = computed(() => this.auth.session.user()?.username ?? '');

  readonly exporting = signal(false);
  readonly exportMessage = signal<{ ok: boolean; text: string } | null>(null);
  readonly confirming = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly form = inject(FormBuilder).nonNullable.group({
    confirmation: [''],
    password: [''],
    code: [''],
  });
  private readonly values = signal(this.form.getRawValue());
  /** The typed name matches, and every proof the account needs is filled in. */
  readonly ready = computed(() => {
    const { confirmation, password, code } = this.values();
    const status = this.status();
    return (
      confirmation === this.username() &&
      (!status?.hasPassword || password.length > 0) &&
      (!status?.twoFactorEnabled || SECOND_FACTOR_CODE.test(code.trim()))
    );
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.values.set(this.form.getRawValue()));
  }

  exportData(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportMessage.set(null);
    this.account
      .exportData()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.exporting.set(false)),
      )
      .subscribe({
        next: (response) => {
          if (!response.body) return;
          const url = URL.createObjectURL(response.body);
          const link = document.createElement('a');
          link.href = url;
          link.download = downloadName(
            response.headers.get('Content-Disposition'),
            '42chess-data.json',
          );
          link.click();
          // Some browsers start the download after click() returns.
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          this.exportMessage.set({ ok: true, text: 'Your data was downloaded.' });
        },
        error: (error: unknown) =>
          this.exportMessage.set({
            ok: false,
            text: settingsError(error, 'Your data could not be prepared. Try again.'),
          }),
      });
  }

  cancel(): void {
    this.confirming.set(false);
    this.deleteError.set('');
    this.form.reset();
  }

  deleteAccount(): void {
    if (!this.ready() || this.deleting()) return;
    const { confirmation, password, code } = this.form.getRawValue();
    const status = this.status();
    const request: DeleteAccountRequest = { confirmation };
    if (status?.hasPassword) request.password = password;
    if (status?.twoFactorEnabled) request.code = code.trim();
    this.deleting.set(true);
    this.deleteError.set('');
    this.account
      .deleteAccount(request)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.deleting.set(false)),
      )
      .subscribe({
        next: () => {
          // The server already revoked every session; this tab forgets its own.
          this.deleted.emit();
          this.realtime.disconnect();
          this.auth.cancelChallenge();
          this.auth.session.clear('Your account was deleted. Thank you for playing.');
          void this.router.navigate(['/login']);
        },
        error: (error: unknown) =>
          this.deleteError.set(
            settingsError(error, 'Your account could not be deleted. Try again.', {
              INVALID_PASSWORD: 'The password is not correct.',
            }),
          ),
      });
  }
}
