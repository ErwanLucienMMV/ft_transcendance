import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from 'prom-client';
import type { DataSource } from 'typeorm';
import { WebSocketServer } from 'ws';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  CHECK_TIMEOUT_MS,
  HEALTH_CACHE_MS,
  HealthService,
  pingWebSocket,
  readBackupStatus,
} from './health.service.js';

/** A stand-in for the chess engine or the bot: answers pings, or not. */
async function pingServer(answer: 'ok' | 'wrong' | 'silent') {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  server.on('connection', (socket) =>
    socket.on('message', (data) => {
      const { id } = JSON.parse((data as Buffer).toString('utf8')) as {
        id: string;
      };
      if (answer === 'ok') socket.send(JSON.stringify({ id, ok: true }));
      if (answer === 'wrong') socket.send(JSON.stringify({ id, ok: false }));
    }),
  );
  const { port } = server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${port}`, close: () => server.close() };
}

describe('HealthService', () => {
  const saved = { ...process.env };
  let directory: string;
  let mail: Server;
  let mailStatus = 200;
  let engines: { url: string; close: () => void }[] = [];

  beforeAll(async () => {
    mail = createServer((request, response) => {
      response.statusCode = request.url === '/health' ? mailStatus : 404;
      response.end();
    });
    await new Promise<void>((resolve) => mail.listen(0, '127.0.0.1', resolve));
  });
  afterAll(() => mail.close());

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'health-'));
    mailStatus = 200;
    const [engine, bot] = await Promise.all([
      pingServer('ok'),
      pingServer('ok'),
    ]);
    engines = [engine, bot];
    process.env.CHESS_ENGINE_URL = engine.url;
    process.env.BOT_ENGINE_URL = bot.url;
    process.env.MAIL_SERVICE_URL = `http://127.0.0.1:${(mail.address() as AddressInfo).port}`;
    process.env.BACKUP_STATUS_FILE = join(directory, 'last-success');
    delete process.env.BACKUP_MAX_AGE_SECONDS;
  });
  afterEach(async () => {
    for (const server of engines) server.close();
    process.env = { ...saved };
    await rm(directory, { recursive: true, force: true });
  });

  const database = (query = vi.fn().mockResolvedValue([{ '?column?': 1 }])) =>
    ({ query }) as unknown as DataSource;

  it('reports every service up and a recent backup', async () => {
    await writeFile(
      process.env.BACKUP_STATUS_FILE!,
      new Date(Date.now() - 600_000).toISOString() + '\n',
    );
    const report = await new HealthService(database()).report();
    expect(report.status).toBe('ok');
    expect(report.services.map(({ name, status }) => [name, status])).toEqual([
      ['database', 'up'],
      ['chess-engine', 'up'],
      ['bot', 'up'],
      ['mail', 'up'],
    ]);
    expect(report.services.every((s) => typeof s.latencyMs === 'number')).toBe(
      true,
    );
    expect(report.backup).toMatchObject({
      status: 'ok',
      maxAgeSeconds: 7200,
    });
    expect(report.backup.ageSeconds).toBeGreaterThanOrEqual(600);
  });

  it('is degraded without the bot or the mail service, down without the database', async () => {
    engines[1].close();
    mailStatus = 503;
    const degraded = await new HealthService(database()).report();
    expect(degraded.status).toBe('degraded');
    expect(
      degraded.services
        .filter((service) => service.status === 'down')
        .map((service) => service.name),
    ).toEqual(['bot', 'mail']);

    const down = await new HealthService(
      database(vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))),
    ).report();
    expect(down.status).toBe('down');
    expect(down.services[0]).toMatchObject({
      name: 'database',
      status: 'down',
    });
  });

  it('gives up on a check after two seconds', async () => {
    // Fake clocks: a busy machine must not make the two seconds look longer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const hanging = database(vi.fn(() => new Promise(() => {})));
    const pending = new HealthService(hanging).report();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    const report = await pending;
    vi.useRealTimers();
    expect(report.services[0]).toEqual({
      name: 'database',
      status: 'down',
      latencyMs: null,
    });
  });

  it('checks at most once per window, whoever asks', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const service = new HealthService(database(query));
    const now = Date.now();
    await Promise.all([service.report(now), service.report(now + 1000)]);
    expect(query).toHaveBeenCalledTimes(1);
    await service.report(now + HEALTH_CACHE_MS);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('exposes the checks and the last backup to Prometheus', async () => {
    const metrics = new MetricsService();
    Object.assign(metrics, { registry: new Registry() });
    await writeFile(process.env.BACKUP_STATUS_FILE!, '2026-11-02T16:00:00Z');
    engines[0].close();
    new HealthService(database(), metrics);
    const text = await metrics.registry.metrics();
    expect(text).toContain('service_up{service="database"} 1');
    expect(text).toContain('service_up{service="chess-engine"} 0');
    expect(text).toContain(
      `backup_last_success_timestamp_seconds ${Date.parse('2026-11-02T16:00:00Z') / 1000}`,
    );
  });
});

describe('pingWebSocket', () => {
  it('needs the matching successful reply', async () => {
    const good = await pingServer('ok');
    const wrong = await pingServer('wrong');
    const silent = await pingServer('silent');
    try {
      await expect(pingWebSocket(good.url)).resolves.toBeUndefined();
      await expect(pingWebSocket(wrong.url)).rejects.toThrow('Unexpected');
      await expect(pingWebSocket(silent.url, 200)).rejects.toThrow('timed out');
      await expect(pingWebSocket('ws://127.0.0.1:1')).rejects.toThrow();
      await expect(pingWebSocket('not a url')).rejects.toThrow();
    } finally {
      for (const server of [good, wrong, silent]) server.close();
    }
  });
});

describe('readBackupStatus', () => {
  const now = Date.parse('2026-11-02T18:00:00Z');
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'backup-'));
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('reads the time backup.sh wrote', async () => {
    const file = join(directory, 'last-success');
    await writeFile(file, '2026-11-02T17:00:00Z\n');
    expect(await readBackupStatus(file, 7200, now)).toEqual({
      status: 'ok',
      lastSuccess: '2026-11-02T17:00:00.000Z',
      ageSeconds: 3600,
      maxAgeSeconds: 7200,
    });
    await writeFile(file, '2026-11-02T15:00:00Z');
    expect(await readBackupStatus(file, 7200, now)).toMatchObject({
      status: 'stale',
      ageSeconds: 10800,
    });
  });

  it('says missing without a file or with garbage in it', async () => {
    const file = join(directory, 'last-success');
    const missing = {
      status: 'missing',
      lastSuccess: null,
      ageSeconds: null,
      maxAgeSeconds: 7200,
    };
    expect(await readBackupStatus(file, 7200, now)).toEqual(missing);
    await writeFile(file, 'yesterday');
    expect(await readBackupStatus(file, 7200, now)).toEqual(missing);
  });
});
