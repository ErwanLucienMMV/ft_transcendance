import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from './api-error';
import { errorText } from './error-text';

function apiError(status: number, body: unknown): ApiError {
  return new ApiError(new HttpErrorResponse({ status, error: body }));
}

describe('errorText', () => {
  it('prefers the feature text for a known code', () => {
    const error = apiError(409, { statusCode: 409, code: 'ALREADY_FRIENDS', message: 'x' });
    expect(errorText(error, 'fallback', { ALREADY_FRIENDS: 'Already friends.' })).toBe(
      'Already friends.',
    );
  });

  it("uses the backend's explanation for a code the feature does not know", () => {
    const error = apiError(503, {
      statusCode: 503,
      code: 'EMAIL_SERVICE_UNAVAILABLE',
      message: 'The verification email could not be sent, try again later',
    });
    expect(errorText(error, 'fallback')).toBe(
      'The verification email could not be sent, try again later',
    );
  });

  it('explains the HTTP status when the server gave no usable message', () => {
    expect(errorText(apiError(502, '<html>gateway</html>'), 'fallback')).toBe(
      'The server is not responding right now. Please try again in a moment.',
    );
    expect(
      errorText(
        apiError(500, { statusCode: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal' }),
        'fallback',
      ),
    ).toBe('Something went wrong on our side. Please try again in a moment.');
    expect(errorText(apiError(0, null), 'fallback')).toBe(
      'Unable to reach the server. Check your connection, then try again.',
    );
  });

  it('keeps the fallback for unknown statuses and non-API errors', () => {
    expect(errorText(apiError(418, {}), 'fallback')).toBe('fallback');
    expect(errorText(new Error('boom'), 'fallback')).toBe('fallback');
  });
});
