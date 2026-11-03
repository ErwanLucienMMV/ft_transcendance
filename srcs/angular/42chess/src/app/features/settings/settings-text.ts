import { errorText } from '../../core/api/error-text';
import { tr } from '../../core/i18n/i18n';

/** Codes a settings form explains in its own words; the others use the shared texts. */
function messages(): Readonly<Record<string, string>> {
  return {
    INVALID_2FA_CODE: tr('settings.errors.invalid2fa'),
    TWO_FACTOR_SETUP_REQUIRED: tr('errors.codes.TWO_FACTOR_SETUP_REQUIRED'),
    TWO_FACTOR_ALREADY_ENABLED: tr('errors.codes.TWO_FACTOR_ALREADY_ENABLED'),
    TWO_FACTOR_NOT_ENABLED: tr('errors.codes.TWO_FACTOR_NOT_ENABLED'),
    USERNAME_ALREADY_EXISTS: tr('errors.codes.USERNAME_ALREADY_EXISTS'),
    INVALID_AVATAR: tr('errors.codes.INVALID_AVATAR'),
    INVALID_PASSWORD: tr('errors.codes.INVALID_PASSWORD'),
    TOO_MANY_2FA_ATTEMPTS: tr('errors.codes.TOO_MANY_2FA_ATTEMPTS'),
    DELETE_CONFIRMATION_MISMATCH: tr('errors.codes.DELETE_CONFIRMATION_MISMATCH'),
    ACTIVE_GAME_EXISTS: tr('settings.errors.activeGame'),
    INVALID_RESET_TOKEN: tr('errors.codes.INVALID_RESET_TOKEN'),
    EMAIL_SERVICE_UNAVAILABLE: tr('errors.codes.EMAIL_SERVICE_UNAVAILABLE'),
  };
}

/** The message a settings form shows for a failed request. */
export function settingsError(
  error: unknown,
  fallback = tr('settings.errors.notSaved'),
  own: Readonly<Record<string, string>> = {},
): string {
  return errorText(error, fallback, { ...messages(), ...own });
}
