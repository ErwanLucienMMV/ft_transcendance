import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp, maskEmail } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { emailVerification } from '../src/templates/email-verification.js';
import { accountNotice } from '../src/templates/account-notice.js';

const TOKEN = 'a'.repeat(43);
const LINK_BASE_URL = 'https://localhost:4443';
const VERIFY_LINK = `${LINK_BASE_URL}/verify-email?token=${TOKEN}`;

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
  const config = loadConfig({ APPURL: `${LINK_BASE_URL}/` });
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
    assert.ok(sent[0].text.includes(VERIFY_LINK));
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

describe('forgemail account emails', () => {
  const sent = [];
  const logs = [];
  const logger = {
    info: (line) => logs.push(line),
    error: (line) => logs.push(line),
  };
  const mailer = {
    async send(mail) {
      sent.push(mail);
    },
  };
  const config = loadConfig({ APPURL: LINK_BASE_URL });
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
  });

  const post = (path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('sends a password reset link without logging the token', async () => {
    const response = await post('/v1/mails/password-reset', {
      to: 'alice@example.com',
      username: 'alice',
      token: TOKEN,
    });

    assert.equal(response.status, 202);
    assert.ok(
      sent[0].text.includes(`${LINK_BASE_URL}/reset-password?token=${TOKEN}`),
    );
    assert.ok(logs.every((line) => !line.includes(TOKEN)));
  });

  it('sends each account notice and refuses unknown ones', async () => {
    for (const kind of [
      'password-changed',
      'two-factor-enabled',
      'two-factor-disabled',
      'data-exported',
      'account-deleted',
    ]) {
      const response = await post('/v1/mails/notice', {
        to: 'alice@example.com',
        username: 'alice',
        kind,
      });
      assert.equal(response.status, 202, kind);
    }
    assert.equal(sent.length, 5);
    assert.equal(sent[0].subject, 'Your password was changed');
    for (const body of [
      { to: 'alice@example.com', username: 'alice', kind: 'toString' },
      { to: 'alice@example.com', username: 'alice' },
    ]) {
      assert.equal((await post('/v1/mails/notice', body)).status, 400);
    }
    assert.equal(
      (await post('/v1/mails/__proto__', { to: 'a@b.c' })).status,
      404,
    );
  });

  it('escapes the username in notices', () => {
    const { html } = accountNotice({
      username: '<b>',
      kind: 'account-deleted',
      publicUrl: LINK_BASE_URL,
    });
    assert.ok(html.includes('&lt;b&gt;') && !html.includes('<b>'));
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

  it('keeps the SMTP password untouched', () => {
    const password = `p@ss w0rd 'with' "quotes" $HOME #1`;

    assert.equal(loadConfig({ SMTP_PASSWORD: password }).smtp.password, password);
  });
});

describe('email verification template', () => {
  it('escapes the username in the HTML version', () => {
    const { html } = emailVerification({
      username: '<script>',
      link: `${LINK_BASE_URL}/verify-email?token=x`,
    });

    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>'));
  });

  it('masks emails in logs', () => {
    assert.equal(maskEmail('alice@example.com'), 'a***@example.com');
  });
});
