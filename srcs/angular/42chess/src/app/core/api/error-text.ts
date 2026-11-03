import { currentLanguage, tr, trIfExists, TranslationKey } from '../i18n/i18n';
import { ApiError } from './api-error';

/** Codes the backend uses for failures it could not explain more precisely. */
const GENERIC_CODES = new Set(['HTTP_ERROR', 'INTERNAL_SERVER_ERROR', 'NETWORK_ERROR']);

type StatusKey =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'tooLarge'
  | 'tooMany'
  | 'server'
  | 'gateway'
  | 'unavailable';

const STATUS_KEYS: Readonly<Record<number, StatusKey>> = {
  0: 'network',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  413: 'tooLarge',
  429: 'tooMany',
  500: 'server',
  502: 'gateway',
  503: 'unavailable',
  504: 'gateway',
};

/** Plain explanation of an HTTP status, used when no better message is known. */
export function statusText(statusCode: number): string | null {
  const key = STATUS_KEYS[statusCode];
  return key ? tr(`errors.status.${key}`) : null;
}

/** The shared explanation of an API error code, in the language shown, if there is one. */
export function codeText(code: string): string | null {
  return trIfExists(`errors.codes.${code}` as TranslationKey);
}

/**
 * The most precise message available for a failed request: the feature's own text for a
 * known code, then the backend's explanation (written in English: other languages use the
 * shared text of its code), then the HTTP status, then the fallback.
 */
export function errorText(
  error: unknown,
  fallback: string,
  known: Readonly<Record<string, string>> = {},
): string {
  if (!(error instanceof ApiError)) return fallback;
  const own = known[error.code];
  if (own) return own;
  if (!GENERIC_CODES.has(error.code) && error.message && error.message !== GENERIC_MESSAGE) {
    if (currentLanguage() === 'en') return error.message;
    const shared = codeText(error.code);
    if (shared) return shared;
  }
  return statusText(error.statusCode) ?? fallback;
}

/** ApiError's own fallback when the body carried no message. */
const GENERIC_MESSAGE = 'The request could not be completed.';
