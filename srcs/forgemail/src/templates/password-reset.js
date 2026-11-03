import { escapeHtml } from './email-verification.js';

/** Email with a link to choose a new password. */
export function passwordReset({ username, link }) {
  return {
    subject: 'Reset your password',
    text: [
      `Hi ${username},`,
      '',
      'Someone asked to reset the password of your 42 Chess account.',
      'To choose a new password, open this link:',
      link,
      '',
      'This link works once and expires in 30 minutes. Choosing a new',
      'password signs you out everywhere.',
      '',
      'If you did not ask for it, ignore this email: your password stays as it is.',
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(username)},</p>
      <p>Someone asked to reset the password of your 42 Chess account.</p>
      <p><a href="${escapeHtml(link)}">Choose a new password</a></p>
      <p>This link works once and expires in 30 minutes. Choosing a new password
        signs you out everywhere.</p>
      <p>If you did not ask for it, ignore this email: your password stays as it is.</p>
    `,
  };
}
