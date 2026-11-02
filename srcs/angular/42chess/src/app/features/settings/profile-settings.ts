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

/** Why a chosen file cannot be sent, before uploading it; null when it can. */
export function avatarProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return 'Choose a PNG, JPEG or WebP image.';
  if (file.size > AVATAR_MAX_BYTES) return 'This image is larger than 2 MB. Choose a smaller one.';
  return null;
}

/** Username and picture. */
@Component({
  selector: 'app-profile-settings',
  imports: [ReactiveFormsModule, UserAvatar],
  template: `
    <section class="card settings-section" aria-labelledby="profile-settings-title">
      <h3 id="profile-settings-title" class="section-title">Profile</h3>
      @if (session.user(); as user) {
        <div class="avatar-editor">
          @if (preview(); as url) {
            <img class="avatar-large" [src]="url" alt="Preview of your new picture" />
          } @else {
            <app-avatar class="avatar-large" [username]="user.username" [url]="user.avatarUrl" />
          }
          <div class="avatar-actions">
            <p class="muted">
              Your picture appears on your profile, in games and in messages. PNG, JPEG or WebP, 2
              MB at most.
            </p>
            @if (chosen()) {
              <div class="row">
                <button type="button" [disabled]="uploading()" (click)="upload()">
                  {{ uploading() ? 'Uploading…' : 'Save picture' }}
                </button>
                <button
                  type="button"
                  class="secondary"
                  [disabled]="uploading()"
                  (click)="cancelChoice()"
                >
                  Cancel
                </button>
              </div>
              @if (uploading()) {
                <progress max="100" [value]="progress()" aria-label="Upload progress">
                  {{ progress() }}%
                </progress>
              }
            } @else {
              <div class="row">
                <label class="button secondary file-button">
                  Choose a picture
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
                    Remove picture
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
            <label for="settings-username">Username</label>
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
              {{ limits.usernameMin }}–{{ limits.usernameMax }} letters, digits or underscores.
              Other players see it everywhere.
            </p>
          </div>
          <div class="row">
            <button type="submit" [disabled]="renaming() || !renamable(user)">
              {{ renaming() ? 'Saving…' : 'Save username' }}
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
          this.usernameSaved.set(`Your username is now ${updated.username}.`);
        },
        error: (error: unknown) =>
          this.usernameError.set(
            settingsError(error, 'Your username could not be changed. Try again.', {
              VALIDATION_ERROR: 'This username is reserved. Choose another one.',
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
            this.avatarSaved.set('Your new picture is saved.');
          }
        },
        error: (error: unknown) =>
          this.avatarError.set(settingsError(error, 'The picture could not be saved. Try again.')),
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
          this.avatarSaved.set('Your picture was removed.');
        },
        error: (error: unknown) =>
          this.avatarError.set(
            settingsError(error, 'The picture could not be removed. Try again.'),
          ),
      });
  }

  private revokePreview(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
    this.preview.set(null);
  }
}
