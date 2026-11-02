import { HttpEventType } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthSession, AuthUser } from '../../core/auth/auth-session';
import { UserAvatar } from '../../shared/user-avatar';
import { AUTH_FIELD_LIMITS } from '../auth/auth-form.models';
import { AccountApi, AVATAR_MAX_BYTES, AVATAR_TYPES } from './account-api';
import { settingsError } from './settings-text';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

/** Why a chosen file cannot be sent, before uploading it; null when it can. */
export function avatarProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return tr('settings.profile.wrongType');
  if (file.size > AVATAR_MAX_BYTES) return tr('settings.profile.tooLarge');
  return null;
}

/** Username and picture. */
@Component({
  selector: 'app-profile-settings',
  imports: [TranslocoDirective, ReactiveFormsModule, UserAvatar],
  template: `
    <ng-container *transloco="let t">
      <section class="card settings-section" aria-labelledby="profile-settings-title">
        <h2 id="profile-settings-title" class="section-title">
          {{ t('settings.profile.title') }}
        </h2>
        @if (session.user(); as user) {
          <div class="avatar-editor">
            @if (preview(); as url) {
              <img class="avatar-large" [src]="url" [alt]="t('settings.profile.preview')" />
            } @else {
              <app-avatar class="avatar-large" [username]="user.username" [url]="user.avatarUrl" />
            }
            <div class="avatar-actions">
              <p class="muted">{{ t('settings.profile.pictureHelp') }}</p>
              @if (chosen()) {
                <div class="row">
                  <button type="button" [disabled]="uploading()" (click)="upload()">
                    {{
                      uploading()
                        ? t('settings.profile.uploading')
                        : t('settings.profile.savePicture')
                    }}
                  </button>
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="uploading()"
                    (click)="cancelChoice()"
                  >
                    {{ t('common.cancel') }}
                  </button>
                </div>
                @if (uploading()) {
                  <progress
                    max="100"
                    [value]="progress()"
                    [attr.aria-label]="t('settings.profile.progress')"
                  >
                    {{ progress() }}%
                  </progress>
                }
              } @else {
                <div class="row">
                  <label class="button secondary file-button">
                    {{ t('settings.profile.choose') }}
                    <input
                      #picker
                      class="sr-only"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      (change)="choose(picker.files); picker.value = ''"
                    />
                  </label>
                  @if (user.avatarUrl) {
                    <button
                      type="button"
                      class="ghost"
                      [disabled]="removing()"
                      (click)="removeAvatar()"
                    >
                      {{ t('settings.profile.removePicture') }}
                    </button>
                  }
                </div>
              }
              @if (avatarError(); as message) {
                <p class="field-error" role="alert">{{ message }}</p>
              }
              @if (avatarSaved()) {
                <p class="saved" role="status">{{ avatarSaved() }}</p>
              }
            </div>
          </div>

          <form class="username-form" (submit)="$event.preventDefault(); rename(user)" novalidate>
            <div class="form-field">
              <label for="settings-username">{{ t('settings.profile.username') }}</label>
              <input
                id="settings-username"
                type="text"
                autocomplete="username"
                [formControl]="username"
                [maxLength]="limits.usernameMax"
                [attr.aria-invalid]="usernameInvalid()"
                aria-describedby="settings-username-help"
              />
              <p id="settings-username-help">
                {{
                  t('settings.profile.usernameHelp', {
                    min: limits.usernameMin,
                    max: limits.usernameMax,
                  })
                }}
              </p>
            </div>
            <div class="row">
              <button type="submit" [disabled]="renaming() || !renamable(user)">
                {{ renaming() ? t('common.saving') : t('settings.profile.saveUsername') }}
              </button>
            </div>
            @if (usernameError(); as message) {
              <p class="field-error" role="alert">{{ message }}</p>
            }
            @if (usernameSaved()) {
              <p class="saved" role="status">{{ usernameSaved() }}</p>
            }
          </form>
        }
      </section>
    </ng-container>
  `,
})
export class ProfileSettings {
  readonly session = inject(AuthSession);
  private readonly account = inject(AccountApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly limits = AUTH_FIELD_LIMITS;

  readonly username = new FormControl(this.session.user()?.username ?? '', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(AUTH_FIELD_LIMITS.usernameMin),
      Validators.maxLength(AUTH_FIELD_LIMITS.usernameMax),
      Validators.pattern(/^[A-Za-z0-9_]+$/),
    ],
  });
  readonly renaming = signal(false);
  readonly usernameError = signal('');
  readonly usernameSaved = signal('');

  readonly chosen = signal<File | null>(null);
  readonly preview = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly removing = signal(false);
  readonly progress = signal(0);
  readonly avatarError = signal('');
  readonly avatarSaved = signal('');
  private readonly value = signal(this.username.value);
  readonly usernameInvalid = computed(() => {
    this.value();
    return this.username.invalid && this.username.dirty;
  });

  constructor() {
    this.username.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.value.set(value));
    this.destroyRef.onDestroy(() => this.revokePreview());
  }

  renamable(user: AuthUser): boolean {
    const value = this.value();
    return this.username.valid && value !== user.username;
  }

  rename(user: AuthUser): void {
    this.username.markAsDirty();
    this.value.set(this.username.value);
    if (!this.renamable(user) || this.renaming()) return;
    const token = this.session.token();
    this.renaming.set(true);
    this.usernameError.set('');
    this.usernameSaved.set('');
    this.account
      .rename(this.username.value)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.renaming.set(false)),
      )
      .subscribe({
        next: (updated) => {
          if (token) this.session.updateUser(updated, token);
          this.usernameSaved.set(tr('settings.profile.renamed', { name: updated.username }));
        },
        error: (error: unknown) =>
          this.usernameError.set(
            settingsError(error, tr('settings.profile.renameFailed'), {
              VALIDATION_ERROR: tr('settings.profile.reserved'),
            }),
          ),
      });
  }

  choose(files: FileList | null): void {
    const file = files?.item(0);
    this.avatarError.set('');
    this.avatarSaved.set('');
    if (!file) return;
    const problem = avatarProblem(file);
    if (problem) {
      this.avatarError.set(problem);
      return;
    }
    this.revokePreview();
    this.chosen.set(file);
    this.preview.set(URL.createObjectURL(file));
  }

  cancelChoice(): void {
    this.revokePreview();
    this.chosen.set(null);
  }

  upload(): void {
    const file = this.chosen();
    if (!file || this.uploading()) return;
    const token = this.session.token();
    this.uploading.set(true);
    this.progress.set(0);
    this.avatarError.set('');
    this.account
      .uploadAvatar(file)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.uploading.set(false)),
      )
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total)
            this.progress.set(Math.round((100 * event.loaded) / event.total));
          if (event.type === HttpEventType.Response && event.body) {
            if (token) this.session.updateUser(event.body, token);
            this.cancelChoice();
            this.avatarSaved.set(tr('settings.profile.pictureSaved'));
          }
        },
        error: (error: unknown) =>
          this.avatarError.set(settingsError(error, tr('settings.profile.pictureFailed'))),
      });
  }

  removeAvatar(): void {
    if (this.removing()) return;
    const token = this.session.token();
    this.removing.set(true);
    this.avatarError.set('');
    this.avatarSaved.set('');
    this.account
      .removeAvatar()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.removing.set(false)),
      )
      .subscribe({
        next: (updated) => {
          if (token) this.session.updateUser(updated, token);
          this.avatarSaved.set(tr('settings.profile.pictureRemoved'));
        },
        error: (error: unknown) =>
          this.avatarError.set(settingsError(error, tr('settings.profile.removeFailed'))),
      });
  }

  private revokePreview(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
    this.preview.set(null);
  }
}
