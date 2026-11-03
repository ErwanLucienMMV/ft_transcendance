/** The languages of the site: each name is written in its own language. */
export const LANGUAGES = [
  { code: 'en', name: 'English', locale: 'en-US' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];
export const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

/** The locale used for dates and numbers in a language. */
export function localeOf(language: Language): string {
  return LANGUAGES.find((item) => item.code === language)!.locale;
}

/** The first supported language among the browser's preferred ones, else English. */
export function browserLanguage(preferred: readonly string[] | undefined): Language {
  for (const tag of preferred ?? []) {
    const code = tag.toLowerCase().split('-')[0];
    if (isLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}
