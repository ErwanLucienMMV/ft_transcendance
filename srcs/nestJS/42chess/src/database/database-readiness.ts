import type { DataSource } from 'typeorm';
import { assertDatabaseRequirements } from './database-preflight.js';

/** Verify the running API and migration history without applying migrations. */
export async function assertApplicationReady(
  source: Pick<DataSource, 'query' | 'migrations'>,
  healthUrl: string,
): Promise<void> {
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`API health check failed: HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('status' in body) ||
    body.status !== 'ok'
  ) {
    throw new Error('API health check did not report status ok');
  }
  await assertDatabaseRequirements(source);
  // showMigrations() may create its history table; this check must only read it.
  const applied: { name: string }[] = await source.query(
    'SELECT name FROM typeorm_migrations',
  );
  const names = new Set(applied.map((migration) => migration.name));
  const pending = source.migrations
    .map((migration) => migration.name ?? migration.constructor.name)
    .filter((name) => !names.has(name));
  if (pending.length) {
    throw new Error(`Pending database migrations: ${pending.join(', ')}`);
  }
}
