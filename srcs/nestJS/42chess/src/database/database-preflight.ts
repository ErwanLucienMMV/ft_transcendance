import { DataSource } from 'typeorm';

export class DatabaseRequirementsError extends Error {
  constructor(message: string) {
    super(`Database requirements: ${message}`);
    this.name = 'DatabaseRequirementsError';
  }
}

/** Read-only checks, before TypeORM creates or changes any migration tables. */
export async function assertDatabaseRequirements(
  source: Pick<DataSource, 'query'>,
): Promise<void> {
  const [settings]: { encoding: string; version: number }[] =
    await source.query(
      `SELECT current_setting('server_encoding') AS encoding,
      current_setting('server_version_num')::integer AS version`,
    );
  if (settings.encoding !== 'UTF8') {
    throw new DatabaseRequirementsError(
      `UTF8 required; existing database uses ${settings.encoding}. ` +
        'Back up and validate the data before restoring into a new UTF8 database. ' +
        'Rebuilding the image does not convert an existing volume.',
    );
  }
  if (settings.version < 150000) {
    throw new DatabaseRequirementsError(
      `PostgreSQL 15 or newer required; server_version_num is ${settings.version}.`,
    );
  }
}

/** Both Nest startup and the migration CLI pass through the same preflight. */
export class CheckedDataSource extends DataSource {
  override async runMigrations(
    options?: Parameters<DataSource['runMigrations']>[0],
  ) {
    await assertDatabaseRequirements(this);
    return super.runMigrations(options);
  }
}
