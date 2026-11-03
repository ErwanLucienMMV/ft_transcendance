import { createHash, timingSafeEqual } from 'node:crypto';
import { alertEmail, parseAlertPayload } from './templates/alert.js';
import { emailVerification } from './templates/email-verification.js';
import { passwordReset } from './templates/password-reset.js';
import { accountNotice, NOTICE_KINDS } from './templates/account-notice.js';

const MAX_BODY_BYTES = 10 * 1024;
// Alertmanager sends at most 20 alerts per notification (max_alerts).
const MAX_ALERT_BODY_BYTES = 256 * 1024;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_MAX_LENGTH = 254;
const USERNAME_MAX_LENGTH = 32;

/** "alice@example.com" -> "a***@example.com": enough to debug, not to leak. */
export function maskEmail(email) {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function isRecipient(body) {
  return (
    typeof body?.to === 'string' &&
    body.to.length <= EMAIL_MAX_LENGTH &&
    body.to.includes('@') &&
    typeof body.username === 'string' &&
    body.username.length > 0 &&
    body.username.length <= USERNAME_MAX_LENGTH
  );
}

function isTokenRequest(body) {
  return (
    isRecipient(body) &&
    typeof body.token === 'string' &&
    TOKEN_FORMAT.test(body.token)
  );
}

function isNoticeRequest(body) {
  return isRecipient(body) && NOTICE_KINDS.includes(body.kind);
}

const digest = (value) => createHash('sha256').update(value).digest();

/** Constant-time check of "Authorization: Bearer <token>". */
function hasToken(req, token) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return Boolean(match) && timingSafeEqual(digest(match[1]), digest(token));
}

/**
 * HTTP handler. Only reachable from the internal Docker network: the API is
 * the only caller. The token is never logged.
 */
export function createApp({ config, mailer, logger = console }) {
  /** Validates, renders and sends one kind of email; the body never reaches the logs. */
  function route(name, valid, render) {
    return async (req, res) => {
      const body = await readJson(req);
      if (!valid(body)) {
        return reply(res, 400, { error: `Invalid ${name} request` });
      }
      try {
        await mailer.send({ to: body.to, ...render(body) });
      } catch (error) {
        logger.error(
          `${name} to ${maskEmail(body.to)} failed: ${error.message}`,
        );
        return reply(res, 503, { error: 'Email could not be sent' });
      }
      logger.info(`${name} sent to ${maskEmail(body.to)}`);
      return reply(res, 202);
    };
  }

  /**
   * Alertmanager webhook: one notification (a group of alerts) becomes one
   * email to the administrators listed in ALERT_EMAIL. Without recipients the
   * alert is only logged, like every email without SMTP credentials.
   */
  async function alerts(req, res) {
    const { token, recipients } = config.alerts;
    if (!token) {
      logger.error('alert refused: ALERT_WEBHOOK_TOKEN is not set');
      return reply(res, 503, { error: 'Alerts are not configured' });
    }
    if (!hasToken(req, token)) {
      return reply(res, 401, { error: 'Invalid token' });
    }
    const payload = parseAlertPayload(
      await readJson(req, MAX_ALERT_BODY_BYTES),
    );
    if (!payload) {
      return reply(res, 400, { error: 'Invalid alert notification' });
    }
    const mail = alertEmail({ ...payload, publicUrl: config.publicUrl });
    if (recipients.length === 0) {
      logger.info(
        `alert not emailed (ALERT_EMAIL is empty): ${mail.subject}\n${mail.text}`,
      );
      return reply(res, 202);
    }
    const masked = recipients.map(maskEmail).join(', ');
    try {
      await mailer.send({ to: recipients.join(', '), ...mail });
    } catch (error) {
      logger.error(`alert to ${masked} failed: ${error.message}`);
      // Alertmanager retries a notification that failed with a 5xx.
      return reply(res, 503, { error: 'Email could not be sent' });
    }
    logger.info(`alert sent to ${masked}: ${mail.subject}`);
    return reply(res, 202);
  }

  const routes = {
    '/v1/mails/email-verification': route(
      'email verification',
      isTokenRequest,
      (body) =>
        emailVerification({
          username: body.username,
          link: `${config.publicUrl}/verify-email?token=${body.token}`,
        }),
    ),
    '/v1/mails/password-reset': route('password reset', isTokenRequest, (body) =>
      passwordReset({
        username: body.username,
        link: `${config.publicUrl}/reset-password?token=${body.token}`,
      }),
    ),
    '/v1/mails/notice': route('account notice', isNoticeRequest, (body) =>
      accountNotice({
        username: body.username,
        kind: body.kind,
        publicUrl: config.publicUrl,
      }),
    ),
    '/v1/alerts': alerts,
  };

  return async function handle(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      return reply(res, 200, { status: 'ok' });
    }
    if (req.method === 'POST' && Object.hasOwn(routes, req.url)) {
      return routes[req.url](req, res);
    }
    return reply(res, 404, { error: 'Not found' });
  };
}
