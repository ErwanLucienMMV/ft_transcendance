/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keysOf, lookup } from '../core/i18n/translation';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';

const OTHERS = { fr, es };
const ENGLISH_KEYS = keysOf(en);

/** `{{name}}` parameters of a text. */
const params = (text: string) =>
  new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));

/** Every template and component of the app, without the tests and the dictionaries. */
function sources(dir = 'src/app'): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === 'src/app/i18n' ? [] : sources(path);
    if (!/\.(html|ts)$/.test(entry.name) || entry.name.endsWith('.spec.ts')) return [];
    return [{ path, text: readFileSync(path, 'utf8') }];
  });
}

/**
 * The keys the code asks for: `t('a.b')`, `tr('a.b')`, `'a.b' | transloco` are exact keys;
 * `t('a.' + x)` or `` tr(`a.${x}`) `` only fix the start of one; `trCount('a')` needs
 * `a.one` and `a.other`.
 */
function usedKeys() {
  const exact: { key: string; path: string }[] = [];
  const prefixes: { key: string; path: string }[] = [];
  for (const { path, text } of sources()) {
    for (const match of text.matchAll(
      /\b(t|tr|trIfExists|trCount)\(\s*(?:'([^']+)'|`([^`$]+)(\$\{)?[^`]*`)\s*([,)+])?/g,
    )) {
      const [, fn, quoted, template, interpolation, after] = match;
      const key = quoted ?? template;
      if (fn === 'trCount' && !interpolation) {
        exact.push({ key: `${key}.one`, path }, { key: `${key}.other`, path });
      } else if (interpolation || after === '+') {
        prefixes.push({ key, path });
      } else {
        exact.push({ key, path });
      }
    }
    for (const match of text.matchAll(/'([\w.-]+)'\s*\|\s*transloco\b/g)) {
      exact.push({ key: match[1], path });
    }
  }
  return { exact, prefixes };
}

describe('Dictionaries', () => {
  for (const [language, dictionary] of Object.entries(OTHERS)) {
    it(`${language} has every English text and nothing more`, () => {
      expect(keysOf(dictionary).sort()).toEqual([...ENGLISH_KEYS].sort());
    });

    it(`${language} texts are filled and use only the English parameters`, () => {
      const wrong = ENGLISH_KEYS.filter((key) => {
        const text = lookup(dictionary, key) ?? '';
        const allowed = params(lookup(en, key)!);
        return !text.trim() || [...params(text)].some((name) => !allowed.has(name));
      });
      expect(wrong).toEqual([]);
    });
  }

  it('fills every English text', () => {
    expect(ENGLISH_KEYS.filter((key) => !lookup(en, key)!.trim())).toEqual([]);
  });

  it('has a text for every key the templates and components ask for', () => {
    const { exact, prefixes } = usedKeys();
    // A sanity check of the scan itself: the app asks for hundreds of texts.
    expect(exact.length).toBeGreaterThan(500);
    const known = new Set(ENGLISH_KEYS);
    expect(exact.filter(({ key }) => !known.has(key))).toEqual([]);
    expect(
      prefixes.filter(({ key }) => !ENGLISH_KEYS.some((existing) => existing.startsWith(key))),
    ).toEqual([]);
  });
});
