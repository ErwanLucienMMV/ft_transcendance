import { isDisposableEmail } from './email.rules.js';

describe('isDisposableEmail', () => {
  it.each([
    'alice@mailinator.com',
    'alice@yopmail.com',
    'alice@MAILINATOR.COM',
    'alice@inbox.mailinator.com',
  ])('detects %s', (email) => {
    expect(isDisposableEmail(email)).toBe(true);
  });

  it.each(['alice@gmail.com', 'alice@student.42.fr', 'alice@example.com'])(
    'allows %s',
    (email) => {
      expect(isDisposableEmail(email)).toBe(false);
    },
  );
});
