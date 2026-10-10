const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Email asking the user to confirm their address. */
export function emailVerification({ username, link }) {
  return {
    subject: 'Confirm your email address',
    text: [
      `Hi ${username},`,
      '',
      'Please confirm your email address to finish creating your account:',
      link,
      '',
      'This link expires in 30 minutes. After that, the account is deleted',
      'and you can register again.',
      '',
      'If you did not create an account, you can ignore this email.',
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(username)},</p>
      <p>Please confirm your email address to finish creating your account:</p>
      <p><a href="${escapeHtml(link)}">Confirm my email</a></p>
      <p>This link expires in 30 minutes. After that, the account is deleted
        and you can register again.</p>
      <p>If you did not create an account, you can ignore this email.</p>
    `,
  };
}
