import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { timeControlLabel } from '../../features/game/games-api';
import { UserAvatar } from '../../shared/user-avatar';
import { RealtimeService, ServerEvent } from '../realtime/realtime.service';

/** A challenge stays as long as a waiting game usually does; a request note, less. */
export const CHALLENGE_NOTICE_MS = 60_000;
export const REQUEST_NOTICE_MS = 20_000;
const MAX_NOTICES = 3;

export interface Notice {
  id: string;
  kind: 'challenge' | 'friend-request';
  username: string;
  avatarUrl: string | null;
  text: string;
  link: string[];
  action: string;
}

/** Builds the notice for an event, or null when the event is not one or is malformed. */
export function noticeFor({ event, data }: ServerEvent): Notice | null {
  if (event === 'CHALLENGE_RECEIVED') {
    const from = data['from'] as Record<string, unknown> | undefined;
    if (
      typeof data['gameId'] !== 'string' ||
      typeof from?.['username'] !== 'string' ||
      typeof data['initialTime'] !== 'number' ||
      typeof data['increment'] !== 'number'
    )
      return null;
    const control = timeControlLabel({
      initialTime: data['initialTime'],
      increment: data['increment'],
    });
    return {
      id: `challenge:${data['gameId']}`,
      kind: 'challenge',
      username: from['username'],
      avatarUrl: typeof from['avatarUrl'] === 'string' ? from['avatarUrl'] : null,
      text: `${from['username']} challenges you to a ${control}${data['rated'] === true ? ' rated' : ''} game.`,
      link: ['/game', data['gameId']],
      action: 'Open the game',
    };
  }
  if (event === 'FRIEND_REQUEST_RECEIVED') {
    const sender = data['sender'] as Record<string, unknown> | undefined;
    const request = data['request'] as Record<string, unknown> | undefined;
    if (typeof sender?.['username'] !== 'string' || typeof request?.['id'] !== 'string')
      return null;
    return {
      id: `request:${request['id']}`,
      kind: 'friend-request',
      username: sender['username'],
      avatarUrl: typeof sender['avatarUrl'] === 'string' ? sender['avatarUrl'] : null,
      text: `${sender['username']} wants to be your friend.`,
      link: ['/friends'],
      action: 'See the request',
    };
  }
  return null;
}

/**
 * Challenges and friend requests arrive while the player is on any page: a short notice says so,
 * with a link. It is not shown on the page that already displays it.
 */
@Component({
  selector: 'app-social-notices',
  imports: [RouterLink, UserAvatar],
  template: `
    <div class="notices" aria-live="polite">
      @for (notice of notices(); track notice.id) {
        <div class="notice" role="status" [attr.data-kind]="notice.kind">
          <app-avatar class="notice-avatar" [username]="notice.username" [url]="notice.avatarUrl" />
          <p>{{ notice.text }}</p>
          <div class="notice-actions">
            <a class="button small" [routerLink]="notice.link" (click)="dismiss(notice.id)">{{
              notice.action
            }}</a>
            <button
              type="button"
              class="ghost small"
              [attr.aria-label]="'Dismiss: ' + notice.text"
              (click)="dismiss(notice.id)"
            >
              Dismiss
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .notices {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 50;
      display: grid;
      gap: 10px;
      width: min(360px, calc(100vw - 32px));
      pointer-events: none;
    }
    .notice {
      pointer-events: auto;
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr);
      gap: 10px 12px;
      align-items: center;
      padding: 14px;
      border: 1px solid var(--accent-line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    }
    .notice p {
      margin: 0;
      font-size: 14px;
    }
    .notice-avatar {
      width: 36px;
      height: 36px;
    }
    .notice-actions {
      grid-column: 2;
      display: flex;
      gap: 8px;
    }
  `,
})
export class SocialNotices {
  private readonly router = inject(Router);
  readonly notices = signal<Notice[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
    inject(RealtimeService)
      .events.pipe(takeUntilDestroyed(destroy))
      .subscribe((event) => {
        const notice = noticeFor(event);
        if (notice && !this.shownByPage(notice)) this.show(notice);
      });
    // Opening the page a notice points to answers it.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(destroy),
      )
      .subscribe(() => {
        for (const notice of this.notices()) if (this.shownByPage(notice)) this.dismiss(notice.id);
      });
  }

  dismiss(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.notices.update((list) => list.filter((notice) => notice.id !== id));
  }

  private show(notice: Notice): void {
    this.dismiss(notice.id);
    const dropped = this.notices().slice(0, Math.max(0, this.notices().length - MAX_NOTICES + 1));
    for (const old of dropped) this.dismiss(old.id);
    this.notices.update((list) => [...list, notice]);
    this.timers.set(
      notice.id,
      setTimeout(
        () => this.dismiss(notice.id),
        notice.kind === 'challenge' ? CHALLENGE_NOTICE_MS : REQUEST_NOTICE_MS,
      ),
    );
  }

  private shownByPage(notice: Notice): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return path === notice.link.join('/');
  }
}
