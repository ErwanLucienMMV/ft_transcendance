import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LevelBar } from '../../shared/level-bar';
import {
  achievementDescription,
  achievementName,
  AchievementProgress,
  PlayerStats,
  ProgressionApi,
  Results,
} from './progression-api';
import { TranslationKey, trCount } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalDatePipe } from '../../shared/ui/local-date';

/**
 * Public statistics of a player: rating and rank, results against players and the computer,
 * level, puzzle streak and achievements.
 */
@Component({
  selector: 'app-player-stats',
  imports: [LocalDatePipe, TranslocoDirective, LevelBar, RouterLink],
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
  readonly rows = computed<{ label: TranslationKey; results: Results }[]>(() => {
    const stats = this.stats();
    if (!stats) return [];
    return [
      { label: 'progression.stats.rated', results: stats.rated },
      { label: 'progression.stats.casual', results: stats.casual },
      { label: 'progression.stats.computer', results: stats.bots },
    ];
  });

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => this.load(id));
    });
  }

  name(achievement: AchievementProgress): string {
    return achievementName(achievement.code, achievement.name);
  }

  description(achievement: AchievementProgress): string {
    return achievementDescription(achievement.code, achievement.description);
  }

  days(streak: number, best: number): string {
    return trCount('progression.stats.days', streak, { best });
  }

  solved(count: number): string {
    return trCount('progression.stats.puzzles', count);
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
