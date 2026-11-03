/**
 * The shape every language must fill: the English dictionary with each text replaced by
 * `string`. A missing or extra key in French or Spanish is a compile error.
 */
export type TranslationShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};

/** Dot paths to every text, such as "game.resign". */
export type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

/** Parameters of a text: `{{name}}` in the text takes `name`. */
export type TranslationParams = Record<string, string | number | null | undefined>;

/** The text at a dot path, or undefined. */
export function lookup(dictionary: object, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replaces `{{ name }}` with the parameter; an unknown one is left empty. */
export function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''));
}

/** Every dot path of a dictionary, for the tests that compare languages. */
export function keysOf(dictionary: object, prefix = ''): string[] {
  return Object.entries(dictionary).flatMap(([key, value]) =>
    typeof value === 'string' ? [prefix + key] : keysOf(value as object, `${prefix}${key}.`),
  );
}
