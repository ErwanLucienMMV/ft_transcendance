import { ApiError } from '../../core/api/api-error';
import { errorText } from '../../core/api/error-text';
import { tr } from '../../core/i18n/i18n';

const CODES = [
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'USERNAME_ALREADY_EXISTS',
  'EMAIL_ALREADY_EXISTS',
  'INVALID_VERIFICATION_TOKEN',
  'INVALID_2FA_CODE',
  'INVALID_2FA_CHALLENGE',
  'OAUTH_LAST_LOGIN_METHOD',
  'OAUTH_ALREADY_LINKED',
  'OAUTH_DISABLED',
  'TOO_MANY_2FA_ATTEMPTS',
  'INVALID_REFRESH_TOKEN',
  'OAUTH_PROVIDER_FAILED',
  'OAUTH_INVALID_FLOW',
  'EMAIL_SERVICE_UNAVAILABLE',
] as const;

/** Codes the sign-in pages explain in their own words. */
function messages(): Record<string, string> {
  return Object.fromEntries(CODES.map((code) => [code, tr(`auth.errors.${code}`)]));
}

export function authFeedback(error: unknown): string {
  if (error instanceof ApiError) {
    return errorText(error, tr('auth.errors.request'), messages());
  }
  return tr('auth.errors.response');
}
