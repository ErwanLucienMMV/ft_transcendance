import source from './data-source.js';
import { validateDatabaseEnvironment } from '../config/environment.js';
import { assertApplicationReady } from './database-readiness.js';

try {
  await source.initialize();
  const { APIPORT } = validateDatabaseEnvironment(process.env);
  await assertApplicationReady(source, `http://127.0.0.1:${APIPORT}/v1/health`);
  console.log('API ready; PostgreSQL requirements met; no pending migrations.');
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Readiness check failed',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
