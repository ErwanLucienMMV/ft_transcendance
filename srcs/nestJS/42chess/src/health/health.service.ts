import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service.js';
import type {
  BackupStatus,
  HealthReport,
  ServiceCheck,
  ServiceName,
} from './health.types.js';

/** Docker, Prometheus and every status page share one check per window. */
export const HEALTH_CACHE_MS = 10_000;
export const CHECK_TIMEOUT_MS = 2_000;
/** Backups run every hour: two hours without one means at least one was missed. */
export const DEFAULT_BACKUP_MAX_AGE_SECONDS = 2 * 60 * 60;
export const DEFAULT_BACKUP_STATUS_FILE = '/backups/status/last-success';

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Check timed out')), ms).unref();
  });
}

/**
 * Sends `{ op: "ping" }` to the chess engine or the bot (both answer it) and
 * waits for the matching reply. Rejects on anything else.
 */
export function pingWebSocket(url: string, ms = CHECK_TIMEOUT_MS) {
  return new Promise<void>((resolve, reject) => {
    const id = randomUUID();
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Invalid URL'));
      return;
    }
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      )
        socket.close();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Ping timed out')), ms);
    socket.addEventListener('open', () => {
      if (settled) return;
      try {
        socket.send(JSON.stringify({ id, op: 'ping' }));
      } catch {
        // Thrown in a listener, it would be an uncaught exception.
        finish(new Error('Ping not sent'));
      }
    });
    socket.addEventListener('message', (event) => {
      try {
        const reply = JSON.parse(String(event.data)) as {
          id?: unknown;
          ok?: unknown;
        };
        finish(
          reply.id === id && reply.ok === true
            ? undefined
            : new Error('Unexpected ping reply'),
        );
      } catch {
        finish(new Error('Unreadable ping reply'));
      }
    });
    socket.addEventListener('error', () => finish(new Error('Unreachable')));
    socket.addEventListener('close', () => finish(new Error('Closed')));
  });
}

/** Reads the time of the last successful backup, written by backup.sh. */
export async function readBackupStatus(
  file: string,
  maxAgeSeconds: number,
  now = Date.now(),
): Promise<BackupStatus> {
  let lastSuccess: number;
  try {
    lastSuccess = Date.parse((await readFile(file, 'utf8')).trim());
  } catch {
    lastSuccess = NaN;
  }
  if (!Number.isFinite(lastSuccess))
    return {
      status: 'missing',
      lastSuccess: null,
      ageSeconds: null,
      maxAgeSeconds,
    };
  const ageSeconds = Math.max(0, Math.floor((now - lastSuccess) / 1000));
  return {
    status: ageSeconds > maxAgeSeconds ? 'stale' : 'ok',
    lastSuccess: new Date(lastSuccess).toISOString(),
    ageSeconds,
    maxAgeSeconds,
  };
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * What `GET /v1/health`, the status page and the monitoring alerts report:
 * the database, the chess engine, the bot, the mail service and the backups.
 * Endpoints are read on each check, like the clients that use them.
 */
@Injectable()
export class HealthService {
  private cached: { at: number; report: Promise<HealthReport> } | null = null;

  constructor(
    private readonly source: DataSource,
    @Optional() metrics?: MetricsService,
  ) {
    if (metrics) this.registerMetrics(metrics);
  }

  report(now = Date.now()): Promise<HealthReport> {
    if (!this.cached || now - this.cached.at >= HEALTH_CACHE_MS)
      this.cached = { at: now, report: this.check() };
    return this.cached.report;
  }

  private async check(): Promise<HealthReport> {
    const env = process.env;
    const [services, backup] = await Promise.all([
      Promise.all([
        this.probe('database', () => this.source.query('SELECT 1')),
        this.probe('chess-engine', () =>
          pingWebSocket(env.CHESS_ENGINE_URL ?? 'ws://127.0.0.1:8081'),
        ),
        this.probe('bot', () =>
          pingWebSocket(env.BOT_ENGINE_URL ?? 'ws://127.0.0.1:8082'),
        ),
        this.probe('mail', async () => {
          const base = env.MAIL_SERVICE_URL ?? 'http://forgemail:3002';
          const response = await fetch(`${base}/health`, {
            signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }),
      ]),
      readBackupStatus(
        env.BACKUP_STATUS_FILE || DEFAULT_BACKUP_STATUS_FILE,
        positive(env.BACKUP_MAX_AGE_SECONDS, DEFAULT_BACKUP_MAX_AGE_SECONDS),
      ),
    ]);
    const down = services.filter((service) => service.status === 'down');
    return {
      status: down.some((service) => service.name === 'database')
        ? 'down'
        : down.length
          ? 'degraded'
          : 'ok',
      checkedAt: new Date().toISOString(),
      services,
      backup,
    };
  }

  private async probe(
    name: ServiceName,
    check: () => Promise<unknown>,
  ): Promise<ServiceCheck> {
    const started = performance.now();
    try {
      await Promise.race([check(), timeout(CHECK_TIMEOUT_MS)]);
      return {
        name,
        status: 'up',
        latencyMs: Math.round(performance.now() - started),
      };
    } catch {
      const elapsed = performance.now() - started;
      return {
        name,
        status: 'down',
        latencyMs: elapsed >= CHECK_TIMEOUT_MS ? null : Math.round(elapsed),
      };
    }
  }

  /** Prometheus reads the same checks: the alert rules fire on these gauges. */
  private registerMetrics(metrics: MetricsService): void {
    const report = () => this.report();
    metrics.gauge({
      name: 'service_up',
      help: 'Whether the API reaches the service (1) or not (0), checked at most every 10 s',
      labelNames: ['service'] as const,
      async collect() {
        for (const service of (await report()).services)
          this.set({ service: service.name }, service.status === 'up' ? 1 : 0);
      },
    });
    metrics.gauge({
      name: 'backup_max_age_seconds',
      help: 'Age past which the last backup is stale (BACKUP_MAX_AGE_SECONDS)',
      async collect() {
        this.set((await report()).backup.maxAgeSeconds);
      },
    });
    metrics.gauge({
      name: 'backup_last_success_timestamp_seconds',
      help: 'Unix time of the last successful database backup; 0 when none was recorded',
      async collect() {
        const { lastSuccess } = (await report()).backup;
        this.set(lastSuccess ? Date.parse(lastSuccess) / 1000 : 0);
      },
    });
  }
}
