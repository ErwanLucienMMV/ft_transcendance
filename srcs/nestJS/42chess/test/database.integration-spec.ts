import { randomUUID } from 'node:crypto';
import { DataSource, Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';

const options = cliDataSource.options;
if (options.type !== 'postgres') {
  throw new Error('Database integration tests require PostgreSQL');
}
const postgresOptions = options;

// This migration belongs to the test only; it never enters the production glob.
class FoundationProbe1700000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(
      new Table({
        name: 'foundation_probe',
        columns: [{ name: 'id', type: 'integer', isPrimary: true }],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable('foundation_probe');
  }
}

describe('PostgreSQL migration lifecycle', () => {
  const schema = `foundation_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;

  beforeAll(async () => {
    source = new DataSource({
      ...postgresOptions,
      schema,
      migrations: [FoundationProbe1700000000000],
    });
    await source.initialize();
    await source.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    if (source?.isInitialized) {
      try {
        await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });

  it('connects to the isolated PostgreSQL 15 database', async () => {
    const [row] = await source.query(
      'SELECT current_database() AS name, version() AS version',
    );
    expect(row.name).toBe('transcendence_test');
    expect(row.version).toContain('PostgreSQL 15.');
  });

  it('applies once, rolls back, then reapplies a migration', async () => {
    expect(await source.runMigrations()).toHaveLength(1);
    await source.query(
      `INSERT INTO "${schema}".foundation_probe (id) VALUES ($1)`,
      [42],
    );
    expect(
      await source.query(`SELECT id FROM "${schema}".foundation_probe`),
    ).toEqual([{ id: 42 }]);
    expect(await source.runMigrations()).toHaveLength(0);
    await source.undoLastMigration();
    const [row] = await source.query('SELECT to_regclass($1) AS relation', [
      `${schema}.foundation_probe`,
    ]);
    expect(row.relation).toBeNull();
    expect(await source.runMigrations()).toHaveLength(1);
  });

  it('rolls back a failed migration without recording it as applied', async () => {
    class FailingProbe1700000000001 implements MigrationInterface {
      async up(runner: QueryRunner): Promise<void> {
        await runner.createTable(
          new Table({
            name: 'must_be_rolled_back',
            columns: [{ name: 'id', type: 'integer' }],
          }),
        );
        throw new Error('Deliberate test failure');
      }
      async down(): Promise<void> {}
    }
    const failing = new DataSource({
      ...postgresOptions,
      schema,
      migrations: [FoundationProbe1700000000000, FailingProbe1700000000001],
    });
    await failing.initialize();
    try {
      await expect(failing.runMigrations()).rejects.toThrow(
        'Deliberate test failure',
      );
      const [row] = await failing.query('SELECT to_regclass($1) AS relation', [
        `${schema}.must_be_rolled_back`,
      ]);
      expect(row.relation).toBeNull();
      const history = await failing.query(
        `SELECT name FROM "${schema}".typeorm_migrations`,
      );
      expect(history).toEqual([{ name: 'FoundationProbe1700000000000' }]);
    } finally {
      await failing.destroy();
    }
  });
});
