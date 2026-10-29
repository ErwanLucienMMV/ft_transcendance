import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import type { PlayerColor } from '../../core/realtime/game-realtime';
import { BOT_LEVELS, BotChoice, GamesApi, TIME_CONTROLS, TimeControlChoice } from './games-api';

export type ColorChoice = PlayerColor | 'RANDOM';

/**
 * Starts a game. Against a friend the creator gets a link and the first person to open it
 * plays; against the bot the game is active at once.
 */
@Component({
  selector: 'app-play-page',
  templateUrl: './play-page.html',
  styleUrl: './play-page.css',
})
export class PlayPage {
  private readonly games = inject(GamesApi);
  private readonly router = inject(Router);
  readonly controls = TIME_CONTROLS;
  readonly selected = signal<TimeControlChoice>(TIME_CONTROLS[2]);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  readonly levels = BOT_LEVELS;
  readonly level = signal<BotChoice>(BOT_LEVELS[0]);
  readonly color = signal<ColorChoice>('WHITE');
  readonly colors: readonly { value: ColorChoice; label: string }[] = [
    { value: 'WHITE', label: 'White' },
    { value: 'RANDOM', label: 'Random' },
    { value: 'BLACK', label: 'Black' },
  ];
  readonly botCreating = signal(false);
  readonly botError = signal<string | null>(null);

  create(): void {
    if (this.creating()) return;
    const { initialTime, increment } = this.selected();
    this.creating.set(true);
    this.error.set(null);
    this.games.create({ initialTime, increment }).subscribe({
      next: ({ gameId }) => void this.router.navigate(['/game', gameId]),
      error: (error: unknown) => {
        this.creating.set(false);
        this.error.set(
          error instanceof ApiError ? error.message : 'The game could not be created.',
        );
      },
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
          this.botError.set(
            error instanceof ApiError ? error.message : 'The bot game could not be created.',
          );
        },
      });
  }
}
