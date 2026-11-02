import { ApiError } from './api-error';

/** Codes the backend uses for failures it could not explain more precisely. */
const GENERIC_CODES = new Set(['HTTP_ERROR', 'INTERNAL_SERVER_ERROR', 'NETWORK_ERROR']);

/** Plain explanation of an HTTP status, used when no better message is known. */
export function statusText(statusCode: number): string | null {
  switch (statusCode) {
    case 0:
      return 'Unable to reach the server. Check your connection, then try again.';
    case 401:
      return 'Your session has expired. Sign in again.';
    case 403:
      return 'You are not allowed to do this.';
    case 404:
      return 'This item no longer exists.';
    case 413:
      return 'This request is too large.';
    case 429:
      return 'Too many attempts. Wait a moment, then try again.';
    case 500:
      return 'Something went wrong on our side. Please try again in a moment.';
    case 502:
    case 504:
      return 'The server is not responding right now. Please try again in a moment.';
    case 503:
      return 'This feature is temporarily unavailable. Please try again in a moment.';
    default:
      return null;
  }
}

/**
 * The most precise message available for a failed request: the feature's own text for a
 * known code, then the backend's explanation, then the HTTP status, then the fallback.
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
    return error.message;
  }
  return statusText(error.statusCode) ?? fallback;
}

/** ApiError's own fallback when the body carried no message. */
const GENERIC_MESSAGE = 'The request could not be completed.';
