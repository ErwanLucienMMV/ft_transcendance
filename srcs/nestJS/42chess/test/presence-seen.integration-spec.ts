import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { User } from '../dist/users/user.entity.js';
import { PresenceService } from '../dist/presence/presence.service.js';

describe('SCRUM-244 durable monotonic lastSeen', () => {
  const schema = `presence_seen_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource, presence: PresenceService, user: User;
  const first = new Date('2026-10-01T00:00:00Z'),
    second = new Date('2026-10-01T00:01:00Z');
  beforeAll(async () => {
    const options = cliDataSource.options;
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    const admin = new DataSource({ ...options, migrations: [] });
    await admin.initialize();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await admin.destroy();
    }
    source = new DataSource({
      ...options,
      schema,
      entities: [User],
      extra: { ...options.extra, options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    presence = new PresenceService(source);
    await presence.onModuleInit();
    user = await source
      .getRepository(User)
      .save({
        username: `seen_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await presence.onModuleDestroy();
    if (user) await source.getRepository(User).delete(user.id);
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      try {
        await source.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });
  const stored = async () =>
    (await source.getRepository(User).findOneByOrFail({ id: user.id }))
      .lastSeenAt;
  it('persists connection and disconnection timestamps and restores them after restart', async () => {
    presence.connect(user.id, 'tab', first);
    await presence.flushSeen();
    expect(await stored()).toEqual(first);
    presence.disconnect(user.id, 'tab', second);
    await presence.flushSeen();
    expect(await stored()).toEqual(second);
    const restored = new PresenceService(source);
    await restored.onModuleInit();
    expect(restored.get(user.id)).toEqual({
      userId: user.id,
      status: 'OFFLINE',
      lastSeen: second,
    });
    await restored.onModuleDestroy();
  });
  it('never moves lastSeen backwards after a clock adjustment or delayed disconnect', async () => {
    presence.connect(user.id, 'tab', second);
    presence.disconnect(user.id, 'tab', first);
    await presence.flushSeen();
    expect(await stored()).toEqual(second);
    expect(presence.get(user.id).lastSeen).toEqual(second);
  });
  it('preserves the newest value while several tab updates are being written', async () => {
    const last = new Date('2026-10-01T00:02:00Z');
    presence.connect(user.id, 'one', first);
    presence.connect(user.id, 'two', second);
    presence.disconnect(user.id, 'one', second);
    presence.disconnect(user.id, 'two', last);
    await presence.flushSeen();
    expect(await stored()).toEqual(last);
  });
  it('retains a failed write and persists it on retry', async () => {
    const failure = vi
      .spyOn(source, 'query')
      .mockRejectedValueOnce(new Error('Injected lastSeen outage'));
    presence.connect(user.id, 'tab', second);
    await expect(presence.flushSeen()).rejects.toThrow(
      'Injected lastSeen outage',
    );
    failure.mockRestore();
    await presence.flushSeen();
    expect(await stored()).toEqual(second);
  });
});
