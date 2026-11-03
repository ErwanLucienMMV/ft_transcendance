import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, parseRecipients } from '../src/config.js';
import {
  alertEmail,
  formatTime,
  parseAlertPayload,
} from '../src/templates/alert.js';

const TOKEN = 'b'.repeat(64);
const PUBLIC_URL = 'https://chess.example.org:8443';

/** What Alertmanager posts (webhook version 4), trimmed to what is read. */
function notification(overrides = {}) {
  return {
    version: '4',
    status: 'firing',
    receiver: 'administrators',
    alerts: [
      {
        status: 'firing',
        labels: {
          alertname: 'TargetDown',
          severity: 'critical',
          job: 'postgres',
          instance: 'postgres-exporter:9187',
        },
        annotations: {
          summary: 'postgres is not answering Prometheus',
          description: 'Prometheus could not scrape postgres-exporter:9187.',
        },
        startsAt: '2026-11-02T16:00:05.123Z',
        endsAt: '0001-01-01T00:00:00Z',
        generatorURL: 'http://prometheus:9090/graph',
      },
    ],
    ...overrides,
  };
}

describe('forgemail alerts', () => {
  const sent = [];
  const logs = [];
  const logger = {
    info: (line) => logs.push(line),
    error: (line) => logs.push(line),
  };
  const mailer = {
    failing: false,
    async send(mail) {
      if (this.failing) throw new Error('SMTP down');
      sent.push(mail);
    },
  };
  const env = {
    APPURL: PUBLIC_URL,
    ALERT_WEBHOOK_TOKEN: TOKEN,
    ALERT_EMAIL: 'ops@example.org, admin@example.org',
  };
  let config = loadConfig(env);
  let server;
  let baseUrl;

  before(async () => {
    // The handler reads `config` on each request, so tests can swap it.
    server = createServer((req, res) =>
      createApp({ config, mailer, logger })(req, res),
    );
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    sent.length = 0;
    logs.length = 0;
    mailer.failing = false;
    config = loadConfig(env);
  });

  const post = (body, token = TOKEN) =>
    fetch(`${baseUrl}/v1/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  it('emails a firing alert to every administrator', async () => {
    const response = await post(notification());

    assert.equal(response.status, 202);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ops@example.org, admin@example.org');
    assert.equal(sent[0].subject, '[42 Chess] Alert: TargetDown');
    assert.ok(sent[0].text.includes('FIRING · critical · TargetDown'));
    assert.ok(sent[0].text.includes('Since: 2026-11-02 16:00:05 UTC'));
    assert.ok(sent[0].text.includes(`${PUBLIC_URL}/status`));
    assert.ok(sent[0].text.includes('job=postgres'));
    assert.ok(logs.some((line) => line.includes('o***@example.org')));
    assert.ok(logs.every((line) => !line.includes('ops@example.org')));
  });

  it('refuses a missing or wrong token', async () => {
    assert.equal((await post(notification(), null)).status, 401);
    assert.equal((await post(notification(), 'c'.repeat(64))).status, 401);
    assert.equal((await post(notification(), 'short')).status, 401);
    assert.equal(sent.length, 0);
  });

  it('refuses alerts when no token is configured', async () => {
    config = loadConfig({ ...env, ALERT_WEBHOOK_TOKEN: '' });

    assert.equal((await post(notification(), '')).status, 503);
    assert.equal(sent.length, 0);
  });

  it('rejects what is not an Alertmanager notification', async () => {
    for (const body of [
      {},
      { alerts: [] },
      { alerts: [{ status: 'firing', labels: {} }] },
      { alerts: [{ status: 'pending', labels: { alertname: 'X' } }] },
      { alerts: 'TargetDown' },
    ]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(sent.length, 0);
  });

  it('only logs the alert when ALERT_EMAIL is empty', async () => {
    config = loadConfig({ ...env, ALERT_EMAIL: '' });

    const response = await post(notification());

    assert.equal(response.status, 202);
    assert.equal(sent.length, 0);
    assert.ok(logs.some((line) => line.includes('[42 Chess] Alert: TargetDown')));
  });

  it('answers 503 so that Alertmanager retries when sending fails', async () => {
    mailer.failing = true;

    assert.equal((await post(notification())).status, 503);
  });
});

describe('alert email', () => {
  it('lists firing alerts first and says when each one ended', () => {
    const payload = parseAlertPayload(
      notification({
        alerts: [
          {
            status: 'resolved',
            labels: { alertname: 'BackupStale', severity: 'warning' },
            annotations: { summary: 'Backups are late' },
            startsAt: '2026-11-02T14:00:00Z',
            endsAt: '2026-11-02T15:30:00Z',
          },
          notification().alerts[0],
        ],
      }),
    );
    const mail = alertEmail({ ...payload, publicUrl: PUBLIC_URL });

    assert.equal(mail.subject, '[42 Chess] Alert: TargetDown, BackupStale');
    assert.ok(mail.text.startsWith('Monitoring alerts on 42 Chess: 1 firing, 1 resolved.'));
    assert.ok(mail.text.indexOf('TargetDown') < mail.text.indexOf('BackupStale'));
    assert.ok(mail.text.includes('Resolved: 2026-11-02 15:30:00 UTC'));
  });

  it('says "Resolved" when the whole group is over', () => {
    const payload = parseAlertPayload(
      notification({
        status: 'resolved',
        alerts: [{ ...notification().alerts[0], status: 'resolved' }],
      }),
    );

    assert.equal(
      alertEmail({ ...payload, publicUrl: PUBLIC_URL }).subject,
      '[42 Chess] Resolved: TargetDown',
    );
  });

  it('escapes labels and annotations in the HTML version', () => {
    const alert = notification().alerts[0];
    const payload = parseAlertPayload(
      notification({
        alerts: [
          {
            ...alert,
            labels: { ...alert.labels, instance: '<img src=x>' },
            annotations: { summary: '<script>alert(1)</script>' },
          },
        ],
      }),
    );
    const { html } = alertEmail({ ...payload, publicUrl: PUBLIC_URL });

    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>') && !html.includes('<img'));
  });

  it('shortens long texts and reads Alertmanager times', () => {
    const alert = notification().alerts[0];
    const payload = parseAlertPayload(
      notification({
        alerts: [{ ...alert, annotations: { description: 'x'.repeat(5000) } }],
      }),
    );

    assert.equal(payload.alerts[0].description.length, 500);
    assert.equal(formatTime('0001-01-01T00:00:00Z'), null);
    assert.equal(formatTime('nonsense'), null);
  });
});

describe('alert recipients', () => {
  it('keeps the addresses and drops the rest', () => {
    assert.deepEqual(
      parseRecipients(' a@x.org,, not-an-address , b@y.org ,a@x.org'),
      ['a@x.org', 'b@y.org'],
    );
    assert.deepEqual(parseRecipients(''), []);
    assert.deepEqual(parseRecipients(undefined), []);
  });
});
