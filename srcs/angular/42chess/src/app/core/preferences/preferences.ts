import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { ApiClient } from '../api/api-client';
import { AuthSession } from '../auth/auth-session';
import type { CurrentUser, UserPreferences } from '../auth/session-lifecycle';
import type { SegmentOption } from '../../shared/ui/segmented';

export type ThemeChoice = UserPreferences['theme'];
/** Read by the inline script of index.html too, so the first paint has the right theme. */
export const PREFERENCES_KEY = '42chess.preferences';
/** The browser bar colour of each theme, the page background. */
export const THEME_COLORS = { dark: '#0b0e0f', light: '#f5f6f1' } as const;

/** The theme switch of the footer and of the settings page. */
export const THEME_OPTIONS: readonly SegmentOption<ThemeChoice>[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'system' },
];

interface Stored {
  theme: ThemeChoice;
  soundEnabled: boolean;
  confirmMoves: boolean;
  premoves: boolean;
}
const DEFAULTS: Stored = {
  theme: 'system',
  soundEnabled: true,
  confirmMoves: false,
  premoves: true,
};

function read(): Stored {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFERENCES_KEY) ?? '{}');
    const value = (typeof raw === 'object' && raw ? raw : {}) as Partial<Stored>;
    return {
      theme: ['light', 'dark', 'system'].includes(value.theme as string)
        ? (value.theme as ThemeChoice)
        : DEFAULTS.theme,
      soundEnabled:
        typeof value.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULTS.soundEnabled,
      confirmMoves:
        typeof value.confirmMoves === 'boolean' ? value.confirmMoves : DEFAULTS.confirmMoves,
      premoves: typeof value.premoves === 'boolean' ? value.premoves : DEFAULTS.premoves,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Display and play preferences. Theme and sound belong to the account (`preferences` of
 * `/users/me`) and are copied in the browser, so a signed-out visitor and the first paint use
 * them too. Move confirmation and premoves are this device's own choice.
 */
@Injectable({ providedIn: 'root' })
export class Preferences {
  private readonly api = inject(ApiClient);
  private readonly session = inject(AuthSession);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stored = signal<Stored>(this.browser ? read() : { ...DEFAULTS });
  private readonly systemDark = signal(true);

  readonly theme = computed(() => this.stored().theme);
  readonly soundEnabled = computed(() => this.stored().soundEnabled);
  readonly confirmMoves = computed(() => this.stored().confirmMoves);
  readonly premoves = computed(() => this.stored().premoves);
  /** The theme actually drawn: "system" follows the device. */
  readonly appliedTheme = computed<'light' | 'dark'>(() => {
    const theme = this.theme();
    return theme === 'system' ? (this.systemDark() ? 'dark' : 'light') : theme;
  });

  /** How many times the player chose each account setting, to keep a recent choice. */
  private readonly choices = { theme: 0, soundEnabled: 0 };

  constructor() {
    if (this.browser && typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-color-scheme: dark)');
      this.systemDark.set(query.matches);
      const listen = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
      query.addEventListener?.('change', listen);
      inject(DestroyRef).onDestroy(() => query.removeEventListener?.('change', listen));
    }
    effect(() => {
      const theme = this.appliedTheme();
      const root = this.document.documentElement;
      root.dataset['theme'] = theme;
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', THEME_COLORS[theme]);
    });
    // Signing in brings the account's choices to this browser, except one made meanwhile.
    let adopted: string | null = null;
    effect(() => {
      const id = this.session.user()?.id ?? null;
      if (!id) adopted = null;
      if (!this.browser || !id || id === adopted) return;
      adopted = id;
      const before = { ...this.choices };
      untracked(() =>
        this.api.get<CurrentUser>('users/me').subscribe({
          next: (user) => {
            const preferences = user.preferences;
            if (!preferences || this.session.user()?.id !== id) return;
            this.save({
              ...(this.choices.theme === before.theme && { theme: preferences.theme }),
              ...(this.choices.soundEnabled === before.soundEnabled && {
                soundEnabled: preferences.soundEnabled,
              }),
            });
          },
          error: () => undefined,
        }),
      );
    });
  }

  setTheme(theme: ThemeChoice): void {
    this.choices.theme++;
    this.save({ theme });
    this.saveToAccount({ theme });
  }

  setSoundEnabled(soundEnabled: boolean): void {
    this.choices.soundEnabled++;
    this.save({ soundEnabled });
    this.saveToAccount({ soundEnabled });
  }

  setConfirmMoves(confirmMoves: boolean): void {
    this.save({ confirmMoves });
  }

  setPremoves(premoves: boolean): void {
    this.save({ premoves });
  }

  private save(change: Partial<Stored>): void {
    this.stored.update((current) => ({ ...current, ...change }));
    try {
      globalThis.localStorage?.setItem(PREFERENCES_KEY, JSON.stringify(this.stored()));
    } catch {
      // Private browsing may refuse storage: the choice still holds for this visit.
    }
  }

  /** Best effort: the choice is already applied and kept in this browser. */
  private saveToAccount(preferences: Partial<UserPreferences>): void {
    if (!this.session.authenticated()) return;
    this.api.patch('users/me', { preferences }).subscribe({ error: () => undefined });
  }
}
