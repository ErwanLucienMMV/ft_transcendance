import { Component, computed, input } from '@angular/core';
import { LevelProgress, levelShare } from '../features/progression/progression-api';
import { TranslocoDirective } from '@jsverse/transloco';

/** The player's level, and how far they are towards the next one. */
@Component({
  selector: 'app-level-bar',
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      <div class="level-head">
        <strong>{{ t('shared.level.title', { level: progress().level }) }}</strong>
        <span>{{ progress().xp }} / {{ progress().nextLevelXp }} XP</span>
      </div>
      <div
        class="track"
        role="progressbar"
        [attr.aria-label]="t('shared.level.progress', { level: progress().level + 1 })"
        [attr.aria-valuemin]="progress().levelXp"
        [attr.aria-valuemax]="progress().nextLevelXp"
        [attr.aria-valuenow]="progress().xp"
        [attr.aria-valuetext]="
          t('shared.level.remaining', { xp: remaining(), level: progress().level + 1 })
        "
      >
        <span class="fill" [style.width.%]="percent()"></span>
      </div>
      <small>{{
        t('shared.level.remaining', { xp: remaining(), level: progress().level + 1 })
      }}</small>
    </ng-container>
  `,
  styles: `
    :host {
      display: grid;
      gap: 6px;
    }
    .level-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-variant-numeric: tabular-nums;
    }
    .level-head strong {
      font-family: var(--font-display);
      color: var(--accent);
    }
    .level-head span,
    small {
      color: var(--muted);
      font-size: 13px;
    }
    .track {
      height: 10px;
      border-radius: 999px;
      background: var(--field);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      transition: width 0.4s ease;
    }
  `,
})
export class LevelBar {
  readonly progress = input.required<LevelProgress>();
  readonly percent = computed(() => Math.round(levelShare(this.progress()) * 100));
  readonly remaining = computed(() =>
    Math.max(0, this.progress().nextLevelXp - this.progress().xp),
  );
}
