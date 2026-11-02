import { escapeHtml } from './email-verification.js';

/**
 * Short notices about a change on the account, so its owner hears of it even when
 * someone else made it. Each one says what to do if it was not them.
 */
const NOTICES = {
  'password-changed': {
    subject: 'Your password was changed',
    lines: [
      'The password of your 42 Chess account was just changed, and every',
      'other session was signed out.',
    ],
    unexpected:
      'If it was not you, use "Forgot your password?" on the sign-in page right away.',
  },
  'two-factor-enabled': {
    subject: 'Two-factor authentication is on',
    lines: [
      'Two-factor authentication was turned on for your 42 Chess account.',
      'Signing in now also asks for a code from your authenticator app.',
    ],
    unexpected:
      'If it was not you, reset your password and contact the administrators.',
  },
  'two-factor-disabled': {
    subject: 'Two-factor authentication is off',
    lines: [
      'Two-factor authentication was turned off for your 42 Chess account.',
    ],
    unexpected:
      'If it was not you, reset your password and turn it back on in your settings.',
  },
  'data-exported': {
    subject: 'Your data was exported',
    lines: [
      'A copy of the data of your 42 Chess account was just downloaded from',
      'your settings.',
    ],
    unexpected: 'If it was not you, change your password right away.',
  },
  'account-deleted': {
    subject: 'Your account was deleted',
    lines: [
      'Your 42 Chess account was deleted, as you asked. Your profile, email,',
      'password, friends and private messages are gone. Games you played stay',
      "in your opponents' history under an anonymous name.",
    ],
    unexpected:
      'If it was not you, contact the administrators: the account cannot be restored.',
  },
};

export const NOTICE_KINDS = Object.keys(NOTICES);

export function accountNotice({ username, kind, publicUrl }) {
  const notice = NOTICES[kind];
  return {
    subject: notice.subject,
    text: [
      `Hi ${username},`,
      '',
      ...notice.lines,
      '',
      notice.unexpected,
      '',
      publicUrl,
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(username)},</p>
      <p>${notice.lines.map(escapeHtml).join(' ')}</p>
      <p>${escapeHtml(notice.unexpected)}</p>
      <p><a href="${escapeHtml(publicUrl)}">42 Chess</a></p>
    `,
  };
}
