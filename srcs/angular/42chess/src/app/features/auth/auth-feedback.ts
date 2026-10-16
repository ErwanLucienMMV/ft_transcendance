import { ApiError } from '../../core/api/api-error';

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect username, email or password.',
  EMAIL_NOT_VERIFIED: 'Verify your email before signing in. You can request another link below.',
  USERNAME_ALREADY_EXISTS: 'This username is already taken.',
  EMAIL_ALREADY_EXISTS: 'This email address is already registered.',
  INVALID_VERIFICATION_TOKEN:
    'This verification link is invalid or has expired. Request another link.',
  INVALID_2FA_CODE: 'This code is invalid. Try the current code from your authenticator.',
  INVALID_2FA_CHALLENGE: 'This sign-in attempt expired. Sign in again.',
};

export function authFeedback(error: unknown): string {
  if (error instanceof ApiError) {
    return (
      messages[error.code] ??
      (error.statusCode === 429
        ? 'Too many attempts. Please try again later.'
        : error.statusCode === 0
          ? 'Unable to reach the server. Please try again.'
          : 'The request could not be completed. Please try again.')
    );
  }
  return 'The authentication response could not be used. Please sign in again.';
}
