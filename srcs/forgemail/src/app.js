import { emailVerification } from './templates/email-verification.js';

const MAX_BODY_BYTES = 10 * 1024;
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

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
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

function isVerificationRequest(body) {
  return (
    typeof body?.to === 'string' &&
    body.to.length <= EMAIL_MAX_LENGTH &&
    body.to.includes('@') &&
    typeof body.username === 'string' &&
    body.username.length > 0 &&
    body.username.length <= USERNAME_MAX_LENGTH &&
    typeof body.token === 'string' &&
    TOKEN_FORMAT.test(body.token)
  );
}

/**
 * HTTP handler. Only reachable from the internal Docker network: the API is
 * the only caller. The token is never logged.
 */
export function createApp({ config, mailer, logger = console }) {
  async function sendEmailVerification(req, res) {
    const body = await readJson(req);
    if (!isVerificationRequest(body)) {
      return reply(res, 400, { error: 'Invalid email verification request' });
    }

    const link = `${config.publicUrl}/verify-email?token=${body.token}`;
    try {
      await mailer.send({
        to: body.to,
        ...emailVerification({ username: body.username, link }),
      });
    } catch (error) {
      logger.error(
        `email verification to ${maskEmail(body.to)} failed: ${error.message}`,
      );
      return reply(res, 503, { error: 'Email could not be sent' });
    }
    logger.info(`email verification sent to ${maskEmail(body.to)}`);
    return reply(res, 202);
  }

  return async function handle(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      return reply(res, 200, { status: 'ok' });
    }
    if (req.method === 'POST' && req.url === '/v1/mails/email-verification') {
      return sendEmailVerification(req, res);
    }
    return reply(res, 404, { error: 'Not found' });
  };
}
