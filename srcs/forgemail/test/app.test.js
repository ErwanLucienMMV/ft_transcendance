import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp, maskEmail } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { emailVerification } from '../src/templates/email-verification.js';

const TOKEN = 'a'.repeat(43);

describe('forgemail', () => {
  const sent = [];
  const logs = [];
  const logger = {
    info: (line) => logs.push(line),
    error: (line) => logs.push(line),
  };
  const mailer = {
    failing: false,
    async send(mail) {
      if (this.failing) {
        throw new Error('SMTP down');
      }
      sent.push(mail);
    },
  };
  const config = loadConfig({ PUBLIC_URL: 'https://chess.test/' });
  let server;
  let baseUrl;

  before(async () => {
    server = createServer(createApp({ config, mailer, logger }));
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    sent.length = 0;
    logs.length = 0;
    mailer.failing = false;
  });

  function post(body) {
    return fetch(`${baseUrl}/v1/mails/email-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('answers its health check', async () => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
  });

  it('sends the verification link and never logs the token', async () => {
    const response = await post({
      to: 'alice@example.com',
      username: 'alice',
      token: TOKEN,
    });

    assert.equal(response.status, 202);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'alice@example.com');
    assert.match(
      sent[0].text,
      new RegExp(`https://chess.test/verify-email\\?token=${TOKEN}`),
    );
    assert.ok(logs.every((line) => !line.includes(TOKEN)));
    assert.ok(logs.some((line) => line.includes('a***@example.com')));
  });

  it('rejects an incomplete or malformed request', async () => {
    for (const body of [
      {},
      { to: 'alice@example.com', username: 'alice', token: 'short' },
      { to: 'not-an-email', username: 'alice', token: TOKEN },
      { to: 'alice@example.com', username: '', token: TOKEN },
    ]) {
      const response = await post(body);
      assert.equal(response.status, 400);
    }
    assert.equal(sent.length, 0);
  });

  it('answers 503 when the email cannot be sent', async () => {
    mailer.failing = true;

    const response = await post({
      to: 'alice@example.com',
      username: 'alice',
      token: TOKEN,
    });

    assert.equal(response.status, 503);
    assert.ok(logs.every((line) => !line.includes(TOKEN)));
  });
});

describe('configuration', () => {
  it('falls back to the log transport without SMTP credentials', () => {
    assert.equal(loadConfig({}).transport, 'log');
    assert.equal(
      loadConfig({ SMTP_USER: 'bot@gmail.com', SMTP_PASSWORD: 'app-pass' })
        .transport,
      'smtp',
    );
  });
});

describe('email verification template', () => {
  it('escapes the username in the HTML version', () => {
    const { html } = emailVerification({
      username: '<script>',
      link: 'https://chess.test/verify-email?token=x',
    });

    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>'));
  });

  it('masks emails in logs', () => {
    assert.equal(maskEmail('alice@example.com'), 'a***@example.com');
  });
});
