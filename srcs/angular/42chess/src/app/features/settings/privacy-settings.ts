import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { UserAvatar } from '../../shared/user-avatar';
import { BlockedPlayer, UsersApi } from '../social/users-api';
import { AccountApi } from './account-api';
import { settingsError } from './settings-text';

/** Who may reach the player, and the players they blocked. */
@Component({
  selector: 'app-privacy-settings',
  imports: [DatePipe, RouterLink, UserAvatar],
  template: `
    <section id="privacy" class="card settings-section" aria-labelledby="privacy-settings-title">
      <h3 id="privacy-settings-title" class="section-title">Privacy</h3>
      <div class="subsection">
        <h4>Messages and challenges</h4>
        <label class="switch">
          <input
            type="checkbox"
            [checked]="friendsOnly()"
            [disabled]="friendsOnly() === null || saving()"
            (change)="setFriendsOnly($event)"
          />
          <span>Only my friends can message or challenge me</span>
        </label>
        <p class="muted">
          Other players can still send you a friend request, and you can still write to anyone.
        </p>
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
        <h4>Blocked players</h4>
        <p class="muted">
          A blocked player cannot message you, challenge you or send you a friend request. They are
          not told. Block someone from their profile or from your conversation.
        </p>
        @if (blockedFailed()) {
          <p class="field-error" role="alert">Your blocked players could not be loaded.</p>
          <div class="row">
            <button type="button" class="secondary" (click)="loadBlocked()">Try again</button>
          </div>
        } @else if (blocked(); as players) {
          @if (players.length === 0) {
            <p>You have not blocked anyone.</p>
          } @else {
            <ul class="methods" aria-label="Blocked players">
              @for (player of players; track player.id) {
                <li>
                  <a class="blocked-player" [routerLink]="['/players', player.id]">
                    <app-avatar [username]="player.username" [url]="player.avatarUrl" />
                    <strong>{{ player.username }}</strong>
                    <small class="muted">since {{ player.blockedAt | date: 'mediumDate' }}</small>
                  </a>
                  <button
                    type="button"
                    class="secondary small"
                    [attr.aria-label]="'Unblock ' + player.username"
                    [disabled]="unblocking() === player.id"
                    (click)="unblock(player)"
                  >
                    Unblock
                  </button>
                </li>
              }
            </ul>
          }
        } @else {
          <p class="muted" role="status">Loading…</p>
        }
        @if (unblockError(); as message) {
          <p class="field-error" role="alert">{{ message }}</p>
        }
      </div>
    </section>
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
            text: 'Your privacy settings could not be loaded. Reload the page to try again.',
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
              ? 'Only your friends can message or challenge you now.'
              : 'Every player can message or challenge you now.',
          });
        },
        error: (error: unknown) => {
          this.saving.set(false);
          input.checked = !wanted;
          this.preferenceMessage.set({
            ok: false,
            text: settingsError(error, 'Your choice could not be saved. Try again.'),
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
            settingsError(error, `${player.username} could not be unblocked. Try again.`),
          );
        },
      });
  }
}
