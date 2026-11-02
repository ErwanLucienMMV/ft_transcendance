import { DataSource } from 'typeorm';
import {
  assertDatabaseRequirements,
  CheckedDataSource,
  DatabaseRequirementsError,
} from './database-preflight.js';

describe('Database preflight', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts UTF8 on PostgreSQL 15 and newer', async () => {
    for (const version of [150000, 160001]) {
      await expect(
        assertDatabaseRequirements({
          query: vi.fn().mockResolvedValue([{ encoding: 'UTF8', version }]),
        }),
      ).resolves.toBeUndefined();
    }
  });

  it('refuses non-UTF8 databases before executing migrations', async () => {
    const migrate = vi.spyOn(DataSource.prototype, 'runMigrations');
    const source = new CheckedDataSource({ type: 'postgres' });
    vi.spyOn(source, 'query').mockResolvedValue([
      { encoding: 'SQL_ASCII', version: 150000 },
    ]);
    await expect(source.runMigrations()).rejects.toThrow(
      'UTF8 required; existing database uses SQL_ASCII',
    );
    expect(migrate).not.toHaveBeenCalled();
  });

  it('refuses an unsupported PostgreSQL version with an actionable error', async () => {
    await expect(
      assertDatabaseRequirements({
        query: vi
          .fn()
          .mockResolvedValue([{ encoding: 'UTF8', version: 140000 }]),
      }),
    ).rejects.toBeInstanceOf(DatabaseRequirementsError);
  });

  it('preserves migration transaction options after checking requirements', async () => {
    const migrate = vi
      .spyOn(DataSource.prototype, 'runMigrations')
      .mockResolvedValue([]);
    const source = new CheckedDataSource({ type: 'postgres' });
    const query = vi
      .spyOn(source, 'query')
      .mockResolvedValue([{ encoding: 'UTF8', version: 150000 }]);
    await source.runMigrations({ transaction: 'all' });
    expect(query).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledWith({ transaction: 'all' });
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(
      migrate.mock.invocationCallOrder[0],
    );
  });

  it('propagates connection errors so Nest can retry transient failures', async () => {
    const error = new Error('Connection refused');
    await expect(
      assertDatabaseRequirements({ query: vi.fn().mockRejectedValue(error) }),
    ).rejects.toBe(error);
  });
});
