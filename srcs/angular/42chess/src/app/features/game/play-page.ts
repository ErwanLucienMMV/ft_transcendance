import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { GamesApi, TIME_CONTROLS, TimeControlChoice } from './games-api';

/** Starts a game against a friend: the creator gets a link, the first person to open it plays. */
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
}
