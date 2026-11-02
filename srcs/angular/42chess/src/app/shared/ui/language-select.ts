import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { isLanguage, LANGUAGES } from '../../core/i18n/languages';
import { Preferences } from '../../core/preferences/preferences';

/**
 * The language of the site. Each name is written in its own language, so a player who landed
 * on a language they cannot read still finds theirs.
 */
@Component({
  selector: 'app-language-select',
  imports: [TranslocoPipe],
  template: `
    <label class="sr-only" [for]="id">{{ 'app.language' | transloco }}</label>
    <!-- Each option marks itself: a value bound on the select is set before its options exist. -->
    <select [id]="id" (change)="choose($any($event.target).value)">
      @for (language of languages; track language.code) {
        <option
          [value]="language.code"
          [attr.lang]="language.code"
          [selected]="language.code === preferences.language()"
        >
          {{ language.name }}
        </option>
      }
    </select>
  `,
  styles: `
    select {
      width: auto;
      min-height: 36px;
      padding: 6px 30px 6px 10px;
      font-size: 13px;
    }
  `,
})
export class LanguageSelect {
  private static next = 0;
  readonly id = `language-${++LanguageSelect.next}`;
  readonly preferences = inject(Preferences);
  readonly languages = LANGUAGES;

  choose(code: string): void {
    if (isLanguage(code)) this.preferences.setLanguage(code);
  }
}
