import { errorText } from '../../core/api/error-text';

const MESSAGES: Readonly<Record<string, string>> = {
  USERNAME_ALREADY_EXISTS: 'This username is already taken.',
  INVALID_AVATAR: 'Choose a PNG, JPEG or WebP image of 2 MB at most.',
  INVALID_PASSWORD: 'The password is not correct.',
  INVALID_2FA_CODE:
    'This code is not valid. Use the current code from your app, or an unused recovery code.',
  TOO_MANY_2FA_ATTEMPTS: 'Too many wrong codes. Wait a few minutes, then try again.',
  TWO_FACTOR_SETUP_REQUIRED: 'This setup expired. Start it again to get a new QR code.',
  TWO_FACTOR_ALREADY_ENABLED: 'Two-factor authentication is already on.',
  TWO_FACTOR_NOT_ENABLED: 'Two-factor authentication is already off.',
  DELETE_CONFIRMATION_MISMATCH: 'Type your username exactly as it is shown.',
  ACTIVE_GAME_EXISTS: 'Finish or resign your current game before deleting your account.',
  INVALID_RESET_TOKEN: 'This reset link is invalid or has expired. Ask for a new one.',
  EMAIL_SERVICE_UNAVAILABLE: 'The email could not be sent right now. Try again in a moment.',
};

/** The message a settings form shows for a failed request. */
export function settingsError(
  error: unknown,
  fallback = 'This could not be saved. Try again.',
  own: Readonly<Record<string, string>> = {},
): string {
  return errorText(error, fallback, { ...MESSAGES, ...own });
}
