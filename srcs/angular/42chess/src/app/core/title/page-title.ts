import { effect, inject, Injectable, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { UnreadMessages } from '../notifications/unread-messages';

export const SITE_TITLE = '42 Chess';

/**
 * The tab title: the route's title, prefixed with what needs the player's attention, such as
 * "(2) Your move · Live game | 42 Chess" for two unread messages while it is their turn.
 */
@Injectable({ providedIn: 'root' })
export class PageTitle extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly unread = inject(UnreadMessages);
  private readonly base = signal(SITE_TITLE);
  /** Set by a page while something waits for the player, such as their move. */
  readonly status = signal<string | null>(null);

  constructor() {
    super();
    effect(() => {
      const count = this.unread.total();
      const status = this.status();
      this.title.setTitle(
        `${count ? `(${count}) ` : ''}${status ? `${status} · ` : ''}${this.base()}`,
      );
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.base.set(this.buildTitle(snapshot) ?? SITE_TITLE);
  }
}
