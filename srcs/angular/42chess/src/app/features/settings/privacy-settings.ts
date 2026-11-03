import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { UserAvatar } from '../../shared/user-avatar';
import { BlockedPlayer, UsersApi } from '../social/users-api';
import { AccountApi } from './account-api';
import { settingsError } from './settings-text';
import { Spinner } from '../../shared/ui/spinner';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalDatePipe } from '../../shared/ui/local-date';
import { tr } from '../../core/i18n/i18n';

/** Who may reach the player, and the players they blocked. */
@Component({
  selector: 'app-privacy-settings',
  imports: [TranslocoDirective, Spinner, LocalDatePipe, RouterLink, UserAvatar],
  template: `
    <ng-container *transloco="let t">
      <section id="privacy" class="card settings-section" aria-labelledby="privacy-settings-title">
        <h2 id="privacy-settings-title" class="section-title">
          {{ t('settings.privacy.title') }}
        </h2>
        <div class="subsection">
          <h3>{{ t('settings.privacy.messages') }}</h3>
          <label class="switch">
            <input
              type="checkbox"
              [checked]="friendsOnly()"
              [disabled]="friendsOnly() === null || saving()"
              (change)="setFriendsOnly($event)"
            />
            <span>{{ t('settings.privacy.friendsOnly') }}</span>
          </label>
          <p class="muted">{{ t('settings.privacy.friendsOnlyHelp') }}</p>
          @if (preferenceMessage(); as message) {
            <p
              [class]="message.ok ? 'saved' : 'field-error'"
              [attr.role]="message.ok ? 'status' : 'alert'"
            >
              {{ message.text }}
            </p>
          }
        </div>

        <div class="subsection">
          <h3>{{ t('settings.privacy.blocked') }}</h3>
          <p class="muted">{{ t('settings.privacy.blockedHelp') }}</p>
          @if (blockedFailed()) {
            <p class="field-error" role="alert">{{ t('settings.privacy.blockedFailed') }}</p>
            <div class="row">
              <button type="button" class="secondary" (click)="loadBlocked()">
                {{ t('common.tryAgain') }}
              </button>
            </div>
          } @else if (blocked(); as players) {
            @if (players.length === 0) {
              <p>{{ t('settings.privacy.noneBlocked') }}</p>
            } @else {
              <ul class="methods" [attr.aria-label]="t('settings.privacy.blocked')">
                @for (player of players; track player.id) {
                  <li>
                    <a class="blocked-player" [routerLink]="['/players', player.id]">
                      <app-avatar [username]="player.username" [url]="player.avatarUrl" />
                      <strong>{{ player.username }}</strong>
                      <small class="muted">{{
                        t('settings.privacy.since', { date: player.blockedAt | localDate })
                      }}</small>
                    </a>
                    <button
                      type="button"
                      class="secondary small"
                      [attr.aria-label]="
                        t('settings.privacy.unblockName', { name: player.username })
                      "
                      [disabled]="unblocking() === player.id"
                      (click)="unblock(player)"
                    >
                      {{ t('settings.privacy.unblock') }}
                    </button>
                  </li>
                }
              </ul>
            }
          } @else {
            <app-spinner [showLabel]="true" />
          }
          @if (unblockError(); as message) {
            <p class="field-error" role="alert">{{ message }}</p>
          }
        </div>
      </section>
    </ng-container>
  `,
})
export class PrivacySettings {
  private readonly account = inject(AccountApi);
  private readonly users = inject(UsersApi);
  private readonly destroyRef = inject(DestroyRef);
  /** Null until the account is read. */
  readonly friendsOnly = signal<boolean | null>(null);
  readonly saving = signal(false);
  readonly preferenceMessage = signal<{ ok: boolean; text: string } | null>(null);
  readonly blocked = signal<BlockedPlayer[] | null>(null);
  readonly blockedFailed = signal(false);
  readonly unblocking = signal<string | null>(null);
  readonly unblockError = signal<string | null>(null);

  constructor() {
    this.account
      .me()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (user) => this.friendsOnly.set(user.preferences?.messagesFromFriendsOnly ?? false),
        error: () =>
          this.preferenceMessage.set({
            ok: false,
            text: tr('settings.privacy.loadFailed'),
          }),
      });
    this.loadBlocked();
  }

  setFriendsOnly(event: Event): void {
    const input = event.target as HTMLInputElement;
    const wanted = input.checked;
    this.saving.set(true);
    this.preferenceMessage.set(null);
    this.account
      .updatePreferences({ messagesFromFriendsOnly: wanted })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.saving.set(false);
          const saved = user.preferences?.messagesFromFriendsOnly ?? wanted;
          this.friendsOnly.set(saved);
          this.preferenceMessage.set({
            ok: true,
            text: saved
              ? tr('settings.privacy.nowFriendsOnly')
              : tr('settings.privacy.nowEveryone'),
          });
        },
        error: (error: unknown) => {
          this.saving.set(false);
          input.checked = !wanted;
          this.preferenceMessage.set({
            ok: false,
            text: settingsError(error, tr('settings.privacy.choiceFailed')),
          });
        },
      });
  }

  loadBlocked(): void {
    this.blockedFailed.set(false);
    this.users
      .blocked()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ users }) => this.blocked.set(users),
        error: () => this.blockedFailed.set(true),
      });
  }

  unblock(player: BlockedPlayer): void {
    if (this.unblocking()) return;
    this.unblocking.set(player.id);
    this.unblockError.set(null);
    this.users
      .unblock(player.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.unblocking.set(null);
          this.blocked.update((list) => list?.filter((item) => item.id !== player.id) ?? null);
        },
        error: (error: unknown) => {
          this.unblocking.set(null);
          this.unblockError.set(
            settingsError(error, tr('settings.privacy.unblockFailed', { name: player.username })),
          );
        },
      });
  }
}
