import { Component, computed, inject } from '@angular/core';
import { Preferences, themeOptions } from '../../core/preferences/preferences';
import { Sounds } from '../../core/sound/sounds';
import { Segmented } from '../../shared/ui/segmented';
import { LanguageSelect } from '../../shared/ui/language-select';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * How the site looks and how games are played on this device. The language, theme and sound
 * follow the account to every browser; move confirmation and premoves stay on this device,
 * since they depend on the screen and the pointer.
 */
@Component({
  selector: 'app-appearance-settings',
  imports: [TranslocoDirective, LanguageSelect, Segmented],
  template: `
    <ng-container *transloco="let t">
      <section
        id="appearance"
        class="card settings-section"
        aria-labelledby="appearance-settings-title"
      >
        <h2 id="appearance-settings-title" class="section-title">
          {{ t('settings.appearance.title') }}
        </h2>
        <div class="subsection">
          <h3>{{ t('app.language') }}</h3>
          <app-language-select />
          <p class="muted">{{ t('settings.appearance.languageHelp') }}</p>
        </div>
        <div class="subsection">
          <h3>{{ t('app.theme') }}</h3>
          <app-segmented
            [label]="t('app.theme')"
            [options]="themes()"
            [value]="preferences.theme()"
            (valueChange)="preferences.setTheme($event)"
          />
          <p class="muted">{{ t('settings.appearance.themeHelp') }}</p>
        </div>
        <div class="subsection">
          <h3>{{ t('settings.appearance.game') }}</h3>
          <label class="switch">
            <input
              type="checkbox"
              data-setting="sound"
              [checked]="preferences.soundEnabled()"
              (change)="setSound($event)"
            />
            <span>{{ t('settings.appearance.sound') }}</span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              data-setting="confirm-moves"
              [checked]="preferences.confirmMoves()"
              (change)="preferences.setConfirmMoves(checked($event))"
            />
            <span>{{ t('settings.appearance.confirmMoves') }}</span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              data-setting="premoves"
              [checked]="preferences.premoves()"
              (change)="preferences.setPremoves(checked($event))"
            />
            <span>{{ t('settings.appearance.premoves') }}</span>
          </label>
          <p class="muted">{{ t('settings.appearance.deviceOnly') }}</p>
        </div>
      </section>
    </ng-container>
  `,
})
export class AppearanceSettings {
  readonly preferences = inject(Preferences);
  private readonly sounds = inject(Sounds);
  readonly themes = computed(themeOptions);

  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  setSound(event: Event): void {
    const on = this.checked(event);
    this.preferences.setSoundEnabled(on);
    // The player hears what they turned on.
    if (on) this.sounds.play('move');
  }
}
