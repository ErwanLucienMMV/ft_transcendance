import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { Challenges } from '../social/challenge';
import { Friend, UsersApi } from '../social/users-api';
import type { PlayerColor } from '../../core/realtime/game-realtime';
import {
  BOT_LEVELS,
  BotChoice,
  GamesApi,
  TIME_CONTROLS,
  TimeControlChoice,
  timeControlLabel,
  WaitingGame,
} from './games-api';
import { formatClock } from './game-clock';
import { MatchmakingSearch } from './matchmaking';
import { tr, TranslationKey } from '../../core/i18n/i18n';
import { errorText } from '../../core/api/error-text';
import { TranslocoDirective } from '@jsverse/transloco';

export type ColorChoice = PlayerColor | 'RANDOM';

/** After this long without an opponent, the page suggests a game against the bot. */
export const BOT_SUGGESTION_MS = 60_000;

/**
 * Starts a game. Matchmaking finds a rated opponent with the same time control; against a
 * friend the creator either gets a link (the first person to open it plays) or reserves the
 * seat for one friend, who is told at once; against the bot the game is active at once.
 */
@Component({
  selector: 'app-play-page',
  imports: [TranslocoDirective, RouterLink],
  templateUrl: './play-page.html',
  styleUrl: './play-page.css',
  providers: [MatchmakingSearch],
})
export class PlayPage {
  private readonly games = inject(GamesApi);
  private readonly router = inject(Router);
  private readonly users = inject(UsersApi);
  private readonly challenges = inject(Challenges);
  private readonly session = inject(AuthSession);
  /** Friends who can be challenged directly; empty until loaded. */
  readonly friends = signal<Friend[]>([]);
  /** The friend the seat is reserved for, or null for an open link. */
  readonly friendId = signal<string | null>(null);
  readonly friendName = computed(
    () => this.friends().find((friend) => friend.id === this.friendId())?.username ?? '',
  );
  readonly controls = TIME_CONTROLS;
  readonly selected = signal<TimeControlChoice>(TIME_CONTROLS[2]);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  /** Games against a friend change Elo only when both chose a rated game. */
  readonly rated = signal(false);
  readonly invitations = signal<WaitingGame[]>([]);
  readonly cancelling = signal<string | null>(null);
  readonly label = timeControlLabel;
  readonly levels = BOT_LEVELS;
  readonly level = signal<BotChoice>(BOT_LEVELS[0]);
  readonly color = signal<ColorChoice>('WHITE');
  readonly colors: readonly { value: ColorChoice; label: TranslationKey }[] = [
    { value: 'WHITE', label: 'common.white' },
    { value: 'RANDOM', label: 'common.random' },
    { value: 'BLACK', label: 'common.black' },
  ];
  readonly botCreating = signal(false);
  readonly botError = signal<string | null>(null);
  readonly search = inject(MatchmakingSearch);
  readonly searching = computed(() => this.search.state() !== 'idle');
  readonly searchLabel = computed(() => {
    const control = this.search.timeControl();
    return control ? timeControlLabel(control) : '';
  });
  private readonly now = signal(Date.now());
  /** "0:42" since the server queued the player. */
  readonly waited = computed(() => {
    const since = this.search.joinedAt();
    return formatClock(since === null ? 0 : this.now() - since, false);
  });
  /** A long search: the opponent pool for this time control may be empty right now. */
  readonly suggestBot = computed(() => {
    const since = this.search.joinedAt();
    return (
      this.search.state() === 'waiting' && since !== null && this.now() - since >= BOT_SUGGESTION_MS
    );
  });
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    if (!this.browser) return;
    this.loadInvitations();
    if (this.session.authenticated())
      this.users.friends().subscribe({
        next: ({ friends }) =>
          this.friends.set([...friends].sort((a, b) => a.username.localeCompare(b.username))),
        error: () => this.friends.set([]),
      });
    let timer: ReturnType<typeof setInterval> | undefined;
    effect(() => {
      clearInterval(timer);
      timer = undefined;
      if (this.search.state() === 'waiting')
        timer = setInterval(() => this.now.set(Date.now()), 1000);
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  findOpponent(): void {
    const { initialTime, increment } = this.selected();
    this.now.set(Date.now());
    this.search.start({ initialTime, increment });
  }

  create(): void {
    if (this.creating()) return;
    const { initialTime, increment } = this.selected();
    this.creating.set(true);
    this.error.set(null);
    const friend = this.friendId();
    if (friend) {
      // The friend gets a notification and a message with the link; the page opens the game.
      this.challenges
        .send(friend, { timeControl: { initialTime, increment }, rated: this.rated() })
        .subscribe({
          next: () => this.creating.set(false),
          error: (error: unknown) => {
            this.creating.set(false);
            this.error.set(errorText(error, tr('play.errors.challenge')));
          },
        });
      return;
    }
    this.games.create({ initialTime, increment }, undefined, this.rated()).subscribe({
      next: ({ gameId }) => void this.router.navigate(['/game', gameId]),
      error: (error: unknown) => {
        this.creating.set(false);
        this.error.set(errorText(error, tr('play.errors.create')));
      },
    });
  }

  /** Stops searching and plays the bot with the same time control. */
  playBotInstead(): void {
    this.search.cancel();
    this.createBot();
  }

  cancelInvitation(id: string): void {
    if (this.cancelling()) return;
    this.cancelling.set(id);
    this.games.cancel(id).subscribe({
      next: () => {
        this.cancelling.set(null);
        this.invitations.update((games) => games.filter((game) => game.id !== id));
      },
      error: () => {
        this.cancelling.set(null);
        this.loadInvitations();
      },
    });
  }

  private loadInvitations(): void {
    this.games.waiting().subscribe({
      next: ({ games }) => this.invitations.set(games),
      error: () => this.invitations.set([]),
    });
  }

  createBot(random = Math.random): void {
    if (this.botCreating()) return;
    const chosen = this.color();
    const color: PlayerColor = chosen === 'RANDOM' ? (random() < 0.5 ? 'WHITE' : 'BLACK') : chosen;
    const { initialTime, increment } = this.selected();
    this.botCreating.set(true);
    this.botError.set(null);
    this.games
      .createBot({
        difficulty: this.level().difficulty,
        color,
        timeControl: { initialTime, increment },
      })
      .subscribe({
        next: ({ gameId }) => void this.router.navigate(['/game', gameId]),
        error: (error: unknown) => {
          this.botCreating.set(false);
          this.botError.set(errorText(error, tr('play.errors.bot')));
        },
      });
  }
}
