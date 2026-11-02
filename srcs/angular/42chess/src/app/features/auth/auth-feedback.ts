import { ApiError } from '../../core/api/api-error';
import { errorText } from '../../core/api/error-text';

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect username, email or password.',
  EMAIL_NOT_VERIFIED: 'Verify your email before signing in. You can request another link below.',
  USERNAME_ALREADY_EXISTS: 'This username is already taken.',
  EMAIL_ALREADY_EXISTS: 'This email address is already registered.',
  INVALID_VERIFICATION_TOKEN:
    'This verification link is invalid or has expired. Request another link.',
  INVALID_2FA_CODE: 'This code is invalid. Try the current code from your authenticator.',
  INVALID_2FA_CHALLENGE: 'This sign-in attempt expired. Sign in again.',
  OAUTH_LAST_LOGIN_METHOD:
    'Keep at least one sign-in method. Link another provider before removing this one.',
  OAUTH_ALREADY_LINKED: 'This provider identity is already linked to another account.',
  OAUTH_DISABLED: 'This sign-in provider is currently unavailable.',
  TOO_MANY_2FA_ATTEMPTS: 'Too many wrong codes. Sign in again to get a new attempt.',
  INVALID_REFRESH_TOKEN: 'Your session has expired. Sign in again.',
  OAUTH_PROVIDER_FAILED: 'The sign-in provider did not answer correctly. Please try again.',
  OAUTH_INVALID_FLOW: 'This external sign-in expired or was already used. Start again.',
  EMAIL_SERVICE_UNAVAILABLE:
    'The verification email could not be sent right now. Please try again later.',
};

export function authFeedback(error: unknown): string {
  if (error instanceof ApiError) {
    return errorText(error, 'The request could not be completed. Please try again.', messages);
  }
  return 'The authentication response could not be used. Please sign in again.';
}
