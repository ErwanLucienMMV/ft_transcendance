import { DOCUMENT, registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import { inject, Injectable, isDevMode, signal } from '@angular/core';
import {
  provideTransloco,
  Translation as TranslocoTranslation,
  TranslocoLoader,
  TranslocoService,
} from '@jsverse/transloco';
import { firstValueFrom, from, Observable, of } from 'rxjs';
import { en } from '../../i18n/en';
import { DEFAULT_LANGUAGE, Language, LANGUAGES, localeOf } from './languages';
import { interpolate, KeyPaths, lookup, TranslationParams, TranslationShape } from './translation';

registerLocaleData(localeFr, 'fr-FR');
registerLocaleData(localeEs, 'es-ES');

/** What French and Spanish must fill, key for key. */
export type Translation = TranslationShape<typeof en>;
export type TranslationKey = KeyPaths<typeof en>;
/** Texts that change with a count: `{ one, other }`. */
export type CountKey = TranslationKey extends infer Key
  ? Key extends `${infer Base}.one`
    ? Base
    : never
  : never;

/** English ships with the app; the other languages are separate chunks loaded on demand. */
const LOADERS: Record<Language, () => Promise<Translation>> = {
  en: () => Promise.resolve(en),
  fr: () => import('../../i18n/fr').then((module) => module.fr),
  es: () => import('../../i18n/es').then((module) => module.es),
};

const loaded = new Map<Language, Translation>([['en', en]]);
const active = signal<Language>(DEFAULT_LANGUAGE);

/**
 * A text in the language shown. Reading it in a template or a computed signal follows the
 * language: the text changes when the player picks another one.
 */
export function tr(key: TranslationKey, params?: TranslationParams): string {
  const text = lookup(loaded.get(active()) ?? en, key) ?? lookup(en, key) ?? key;
  return interpolate(text, params);
}

/** The text at a key built at run time (an API code), or null when there is none. */
export function trIfExists(key: TranslationKey, params?: TranslationParams): string | null {
  const text = lookup(loaded.get(active()) ?? en, key) ?? lookup(en, key);
  return text === undefined ? null : interpolate(text, params);
}

/** The form of a counted text that the language needs ("1 move", "2 moves"). */
export function trCount(key: CountKey, count: number, params?: TranslationParams): string {
  const form = new Intl.PluralRules(localeOf(active())).select(count);
  return tr(`${key}.${form === 'one' ? 'one' : 'other'}` as TranslationKey, { count, ...params });
}

export function currentLanguage(): Language {
  return active();
}

/** The locale of dates and numbers, such as "fr-FR". */
export function currentLocale(): string {
  return localeOf(active());
}

/** Hands the dictionaries to Transloco, which draws the templates. */
@Injectable({ providedIn: 'root' })
export class DictionaryLoader implements TranslocoLoader {
  getTranslation(language: string): Observable<TranslocoTranslation> {
    const code = language as Language;
    const known = loaded.get(code);
    if (known) return of(known as unknown as TranslocoTranslation);
    return from(
      LOADERS[code]().then((dictionary) => {
        loaded.set(code, dictionary);
        return dictionary as unknown as TranslocoTranslation;
      }),
    );
  }
}

export function provideI18n() {
  return provideTransloco({
    config: {
      availableLangs: LANGUAGES.map((language) => language.code),
      defaultLang: DEFAULT_LANGUAGE,
      fallbackLang: DEFAULT_LANGUAGE,
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
      missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
    },
    loader: DictionaryLoader,
  });
}

/** Switches the whole site to a language once its texts are loaded. */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  readonly language = active.asReadonly();

  async use(language: Language): Promise<void> {
    await firstValueFrom(this.transloco.load(language));
    this.transloco.setActiveLang(language);
    active.set(language);
    this.document.documentElement.lang = language;
  }
}
