import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LevelBar } from '../../shared/level-bar';
import { AchievementProgress, PlayerStats, ProgressionApi, Results } from './progression-api';

/**
 * Public statistics of a player: rating and rank, results against players and the computer,
 * level, puzzle streak and achievements.
 */
@Component({
  selector: 'app-player-stats',
  imports: [DatePipe, LevelBar, RouterLink],
  templateUrl: './player-stats.html',
  styleUrl: './player-stats.css',
})
export class PlayerStatsPanel {
  private readonly api = inject(ProgressionApi);
  readonly userId = input.required<string>();
  readonly elo = input.required<number>();

  readonly stats = signal<PlayerStats | null>(null);
  readonly achievements = signal<AchievementProgress[] | null>(null);
  readonly failed = signal(false);

  readonly unlocked = computed(
    () => this.achievements()?.filter((achievement) => achievement.unlockedAt).length ?? 0,
  );
  readonly rows = computed<{ label: string; results: Results }[]>(() => {
    const stats = this.stats();
    if (!stats) return [];
    return [
      { label: 'Rated', results: stats.rated },
      { label: 'Casual', results: stats.casual },
      { label: 'Computer', results: stats.bots },
    ];
  });

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => this.load(id));
    });
  }

  percent(achievement: AchievementProgress): number {
    return Math.round((Math.min(achievement.progress, achievement.goal) / achievement.goal) * 100);
  }

  private load(id: string): void {
    this.stats.set(null);
    this.achievements.set(null);
    this.failed.set(false);
    this.api.stats(id).subscribe({
      next: (stats) => this.stats.set(stats),
      error: () => this.failed.set(true),
    });
    this.api.achievements(id).subscribe({
      next: ({ achievements }) => this.achievements.set(achievements),
      error: () => this.failed.set(true),
    });
  }
}
