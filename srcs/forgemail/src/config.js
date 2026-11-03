const DEFAULT_PORT = 3002;
const DEFAULT_SMTP_HOST = 'smtp.gmail.com';
// Gmail: port 465 uses TLS from the first byte.
const DEFAULT_SMTP_PORT = 465;
const EMAIL_MAX_LENGTH = 254;

/** "a@x.org, b@y.org" -> both addresses; anything that is not an address is dropped. */
export function parseRecipients(value = '') {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(
          (item) =>
            item.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+$/.test(item),
        ),
    ),
  ];
}

/**
 * Reads the configuration from the environment (srcs/.env, never committed).
 * Without SMTP credentials, as in .env.example and CI, mails are written to
 * the logs instead of being sent, so the service always starts.
 */
export function loadConfig(env = process.env) {
  const user = env.SMTP_USER ?? '';
  const password = env.SMTP_PASSWORD ?? '';

  return {
    port: Number(env.FORGEMAIL_PORT || DEFAULT_PORT),
    publicUrl: (env.APPURL || 'https://localhost:8080').replace(/\/+$/, ''),
    transport: user && password ? 'smtp' : 'log',
    smtp: {
      host: env.SMTP_HOST || DEFAULT_SMTP_HOST,
      port: Number(env.SMTP_PORT || DEFAULT_SMTP_PORT),
      user,
      password,
    },
    from: env.MAIL_FROM || user || 'ft_transcendence <no-reply@localhost>',
    // Monitoring alerts from Alertmanager, sent to the administrators.
    alerts: {
      token: env.ALERT_WEBHOOK_TOKEN ?? '',
      recipients: parseRecipients(env.ALERT_EMAIL),
    },
  };
}
