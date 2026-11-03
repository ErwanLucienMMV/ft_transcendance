import { Component, inject } from '@angular/core';
import { Preferences, THEME_OPTIONS } from '../../core/preferences/preferences';
import { Sounds } from '../../core/sound/sounds';
import { Segmented } from '../../shared/ui/segmented';

/**
 * How the site looks and how games are played on this device. The theme and the sound follow the
 * account to every browser; move confirmation and premoves stay on this device, since they depend
 * on the screen and the pointer.
 */
@Component({
  selector: 'app-appearance-settings',
  imports: [Segmented],
  template: `
    <section
      id="appearance"
      class="card settings-section"
      aria-labelledby="appearance-settings-title"
    >
      <h2 id="appearance-settings-title" class="section-title">Appearance and games</h2>
      <div class="subsection">
        <h3 id="theme-title">Theme</h3>
        <app-segmented
          label="Theme"
          [options]="themes"
          [value]="preferences.theme()"
          (valueChange)="preferences.setTheme($event)"
        />
        <p class="muted">System follows the light or dark setting of your device.</p>
      </div>
      <div class="subsection">
        <h3>During a game</h3>
        <label class="switch">
          <input
            type="checkbox"
            data-setting="sound"
            [checked]="preferences.soundEnabled()"
            (change)="setSound($event)"
          />
          <span>Sounds for moves, captures, checks and the end of the game</span>
        </label>
        <label class="switch">
          <input
            type="checkbox"
            data-setting="confirm-moves"
            [checked]="preferences.confirmMoves()"
            (change)="preferences.setConfirmMoves(checked($event))"
          />
          <span>Ask me to confirm each move before it is sent</span>
        </label>
        <label class="switch">
          <input
            type="checkbox"
            data-setting="premoves"
            [checked]="preferences.premoves()"
            (change)="preferences.setPremoves(checked($event))"
          />
          <span>Let me prepare my next move while my opponent thinks (premove)</span>
        </label>
        <p class="muted">
          Move confirmation and premoves apply to this device only, so a phone can confirm moves
          while a computer does not.
        </p>
      </div>
    </section>
  `,
})
export class AppearanceSettings {
  readonly preferences = inject(Preferences);
  private readonly sounds = inject(Sounds);
  readonly themes = THEME_OPTIONS;

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
