import { assertApplicationReady } from './database-readiness.js';

describe('Application readiness', () => {
  const healthUrl = 'http://127.0.0.1:3000/v1/health';
  const source = () => ({
    migrations: [{ name: 'Example1700000000000', up: vi.fn(), down: vi.fn() }],
    query: vi
      .fn()
      .mockResolvedValueOnce([{ encoding: 'UTF8', version: 150000 }])
      .mockResolvedValueOnce([{ name: 'Example1700000000000' }]),
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires healthy API, supported database settings and all migrations applied', async () => {
    const fetchHealth = vi
      .fn()
      .mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchHealth);
    const database = source();
    await expect(
      assertApplicationReady(database, healthUrl),
    ).resolves.toBeUndefined();
    expect(fetchHealth).toHaveBeenCalledWith(healthUrl, {
      signal: expect.any(AbortSignal),
    });
    expect(database.query).toHaveBeenLastCalledWith(
      'SELECT name FROM typeorm_migrations',
    );
  });

  it.each([
    [503, { status: 'ok' }],
    [200, { status: 'unhealthy' }],
  ])('fails on unhealthy API responses (%s)', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(body, { status })),
    );
    const database = source();
    await expect(assertApplicationReady(database, healthUrl)).rejects.toThrow(
      'API health check',
    );
    expect(database.query).not.toHaveBeenCalled();
  });

  it('reports pending migrations instead of applying them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'ok' })),
    );
    const database = source();
    database.query
      .mockReset()
      .mockResolvedValueOnce([{ encoding: 'UTF8', version: 150000 }])
      .mockResolvedValueOnce([]);
    await expect(assertApplicationReady(database, healthUrl)).rejects.toThrow(
      'Pending database migrations: Example1700000000000',
    );
  });

  it('fails if migration history is missing without creating it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'ok' })),
    );
    const database = source();
    const missing = new Error('relation typeorm_migrations does not exist');
    database.query
      .mockReset()
      .mockResolvedValueOnce([{ encoding: 'UTF8', version: 150000 }])
      .mockRejectedValueOnce(missing);
    await expect(assertApplicationReady(database, healthUrl)).rejects.toBe(
      missing,
    );
  });
});
