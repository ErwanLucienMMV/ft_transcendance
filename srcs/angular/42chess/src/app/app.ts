import { Component, computed, DestroyRef, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { SessionLifecycle } from './core/auth/session-lifecycle';
import { AuthSession } from './core/auth/auth-session';
import { SocialNotices } from './core/notifications/social-notices';
import { UnreadMessages } from './core/notifications/unread-messages';
import { Preferences, themeOptions } from './core/preferences/preferences';
import { RealtimeService } from './core/realtime/realtime.service';
import { Badge } from './shared/ui/badge';
import { LanguageSelect } from './shared/ui/language-select';
import { Segmented } from './shared/ui/segmented';
import { ToastHost } from './shared/ui/toasts';
import { UserAvatar } from './shared/user-avatar';

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    SocialNotices,
    UserAvatar,
    Badge,
    LanguageSelect,
    Segmented,
    ToastHost,
    TranslocoDirective,
  ],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly session = inject(AuthSession);
  protected readonly preferences = inject(Preferences);
  protected readonly unread = inject(UnreadMessages);
  protected readonly themes = computed(themeOptions);
  private readonly lifecycle = inject(SessionLifecycle);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Presence (spec §29) counts authenticated sockets, so a signed-in tab keeps one open.
    const realtime = inject(RealtimeService);
    effect(() => {
      if (this.session.authenticated()) untracked(() => realtime.connect());
    });
  }

  signOut(): void {
    const leave = () => {
      if (!this.session.authenticated()) void this.router.navigate(['/login']);
    };
    this.lifecycle
      .signOut()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: leave, error: leave });
  }
}
