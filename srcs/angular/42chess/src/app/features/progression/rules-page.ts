import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  achievementDescription,
  achievementName,
  ProgressionApi,
  ProgressionRules,
} from './progression-api';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { TranslocoDirective } from '@jsverse/transloco';

/** How rating, XP, levels, the puzzle streak and achievements work, with the server's numbers. */
@Component({
  selector: 'app-rules-page',
  imports: [TranslocoDirective, EmptyState, Alert, RouterLink],
  templateUrl: './rules-page.html',
  styleUrl: './rules-page.css',
})
export class RulesPage {
  readonly rules = signal<ProgressionRules | null>(null);
  readonly failed = signal(false);

  constructor() {
    inject(ProgressionApi)
      .rules()
      .subscribe({
        next: (rules) => this.rules.set(rules),
        error: () => this.failed.set(true),
      });
  }

  name(achievement: { code: string; name: string }): string {
    return achievementName(achievement.code, achievement.name);
  }

  description(achievement: { code: string; description: string }): string {
    return achievementDescription(achievement.code, achievement.description);
  }

  half(value: number, divisor: number): number {
    return Math.floor(value / divisor);
  }
}
