import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { MatchmakingService } from '../dist/matchmaking/matchmaking.service.js';
import { MatchmakingEntry } from '../dist/matchmaking/matchmaking-queue.entity.js';
import { User } from '../dist/users/user.entity.js';
import { areCompatible } from '../dist/matchmaking/matchmaking.policy.js';

describe('MATCH-05 transactional opponent selection on PostgreSQL', () => {
  const schema = `match_find_${randomUUID().replaceAll('-', '')}`;
  const now = new Date('2026-10-26T12:00:00.000Z');
  let source: DataSource;
  let service: MatchmakingService;
  let seeker: MatchmakingEntry;

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
      entities: [User, MatchmakingEntry],
      extra: { ...options.extra, options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
    service = new MatchmakingService(source);
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

  async function entry(
    patch: Partial<MatchmakingEntry> = {},
  ): Promise<MatchmakingEntry> {
    const user = await source.getRepository(User).save({
      username: randomUUID().replaceAll('-', ''),
      emailVerifiedAt: now,
    });
    return source.getRepository(MatchmakingEntry).save({
      userId: user.id,
      rating: 1500,
      initialTime: 300000,
      increment: 2000,
      createdAt: now,
      leaseExpiresAt: new Date(+now + 30000),
      status: 'WAITING',
      ...patch,
    });
  }

  async function find(manager: EntityManager, target = seeker) {
    const locked = await manager.findOneOrFail(MatchmakingEntry, {
      where: { id: target.id },
      lock: { mode: 'pessimistic_write' },
    });
    return service.findCompatible(manager, locked, now);
  }

  const select = () => source.transaction((manager) => find(manager));
  const age = (milliseconds: number) => new Date(+now - milliseconds);

  beforeEach(async () => {
    await source.query('TRUNCATE users, games CASCADE');
    seeker = await entry();
  });

  it('returns null for an empty compatible pool and requires a transaction', async () => {
    expect(await select()).toBeNull();
    await expect(
      service.findCompatible(source.manager, seeker, now),
    ).rejects.toThrow('active transaction');
  });

  it('chooses FIFO rather than nearest rating and leaves statuses unchanged', async () => {
    const oldest = await entry({ rating: 1400, createdAt: age(90000) });
    await entry({ rating: 1500, createdAt: age(30000) });
    expect((await select())?.id).toBe(oldest.id);
    const rows = await source.getRepository(MatchmakingEntry).find();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === 'WAITING')).toBe(true);
    expect(await source.query('SELECT id FROM games')).toHaveLength(0);
  });

  it('excludes an opponent at the expiry boundary even before worker cleanup', async () => {
    await entry({ createdAt: age(10000), leaseExpiresAt: now });
    const live = await entry();
    expect((await select())?.id).toBe(live.id);
  });

  it('rejects a seeker at the expiry boundary even with a live opponent', async () => {
    await entry();
    await source.getRepository(MatchmakingEntry).update(seeker.id, {
      leaseExpiresAt: now,
    });
    expect(await select()).toBeNull();
  });

  it('breaks identical timestamp ties by UUID', async () => {
    const high = await entry({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    const low = await entry({ id: '00000000-0000-4000-8000-000000000001' });
    expect(high.createdAt).toEqual(low.createdAt);
    expect((await select())?.id).toBe(low.id);
  });

  it('excludes self, terminal statuses and each different control field', async () => {
    await entry({ status: 'MATCHED', createdAt: age(600000) });
    await entry({ status: 'CANCELLED', createdAt: age(600000) });
    await entry({ initialTime: 180000, createdAt: age(600000) });
    await entry({ increment: 0, createdAt: age(600000) });
    expect(await select()).toBeNull();
    const compatible = await entry();
    expect((await select())?.id).toBe(compatible.id);
  });

  it('bounds widening by both players and includes the exact rating boundary', async () => {
    await source.getRepository(MatchmakingEntry).update(seeker.id, {
      createdAt: age(600000),
    });
    const freshOutside = await entry({ rating: 1601 });
    expect(await select()).toBeNull();
    await source.getRepository(MatchmakingEntry).update(freshOutside.id, {
      rating: 1600,
    });
    expect((await select())?.id).toBe(freshOutside.id);
    await source.getRepository(MatchmakingEntry).update(freshOutside.id, {
      rating: 1901,
      createdAt: age(600000),
    });
    expect(await select()).toBeNull();
    await source.getRepository(MatchmakingEntry).update(freshOutside.id, {
      rating: 1900,
    });
    expect((await select())?.id).toBe(freshOutside.id);
  });

  it('does not let an older opponent widen a freshly joined seeker', async () => {
    await entry({ rating: 1601, createdAt: age(600000) });
    expect(await select()).toBeNull();
  });

  it.each([29999, 30000, 59999, 60000, 179999, 180000, 600000, -1])(
    'agrees with the pure policy at wait age %i milliseconds',
    async (wait) => {
      await source.getRepository(MatchmakingEntry).update(seeker.id, {
        createdAt: age(600000),
      });
      const target = await entry({ rating: 1650, createdAt: age(wait) });
      const current = await source
        .getRepository(MatchmakingEntry)
        .findOneByOrFail({ id: seeker.id });
      expect((await select())?.id ?? null).toBe(
        areCompatible(current, target, now) ? target.id : null,
      );
    },
  );

  it('uses policy millisecond precision for PostgreSQL microsecond timestamps', async () => {
    await source.getRepository(MatchmakingEntry).update(seeker.id, {
      createdAt: age(600000),
    });
    const target = await entry({ rating: 1650, createdAt: age(30000) });
    await source.query(
      `UPDATE matchmaking_queue SET "createdAt" = "createdAt" + interval '0.000456 seconds' WHERE id = $1`,
      [target.id],
    );
    expect((await select())?.id).toBe(target.id);
  });

  it('skips accounts that became unverified or entered an active game', async () => {
    const unverified = await entry({ createdAt: age(120000) });
    await source.getRepository(User).update(unverified.userId, {
      emailVerifiedAt: null,
    });
    const playing = await entry({ createdAt: age(60000) });
    const [game] = await source.query(
      `INSERT INTO games (status, "initialTime", "startedAt") VALUES ('ACTIVE', 300000, now()) RETURNING id`,
    );
    await source.query(
      `INSERT INTO game_players ("gameId", "userId", color) VALUES ($1, $2, 'WHITE')`,
      [game.id, playing.userId],
    );
    const available = await entry();
    expect((await select())?.id).toBe(available.id);
  });

  it('rejects an ineligible seeker and a terminal seeker', async () => {
    await entry();
    await source.getRepository(User).update(seeker.userId, {
      emailVerifiedAt: null,
    });
    expect(await select()).toBeNull();
    await source.getRepository(User).update(seeker.userId, {
      emailVerifiedAt: now,
    });
    await source.getRepository(MatchmakingEntry).update(seeker.id, {
      status: 'MATCHED',
    });
    expect(await select()).toBeNull();
  });

  it('rejects a seeker whose active game started after joining', async () => {
    await entry();
    const [game] = await source.query(
      `INSERT INTO games (status, "initialTime", "startedAt") VALUES ('ACTIVE', 300000, now()) RETURNING id`,
    );
    await source.query(
      `INSERT INTO game_players ("gameId", "userId", color) VALUES ($1, $2, 'WHITE')`,
      [game.id, seeker.userId],
    );
    expect(await select()).toBeNull();
  });

  it('keeps bounded rating arithmetic valid at PostgreSQL integer extremes', async () => {
    await source.getRepository(MatchmakingEntry).update(seeker.id, {
      rating: 2147483647,
    });
    const target = await entry({ rating: 2147483647 - 100 });
    expect((await select())?.id).toBe(target.id);
    await source
      .getRepository(MatchmakingEntry)
      .update(seeker.id, { rating: 0 });
    await source
      .getRepository(MatchmakingEntry)
      .update(target.id, { rating: 100 });
    expect((await select())?.id).toBe(target.id);
  });

  it('skips a reserved opponent, locks only its selection and releases on rollback', async () => {
    const oldest = await entry({ createdAt: age(120000) });
    const next = await entry({ createdAt: age(60000) });
    const secondSeeker = await entry();
    const reservation = source.createQueryRunner();
    await reservation.connect();
    await reservation.startTransaction();
    try {
      expect((await find(reservation.manager))?.id).toBe(oldest.id);
      await source.transaction(async (manager) => {
        await manager.query("SET LOCAL statement_timeout = '1500ms'");
        expect((await find(manager, secondSeeker))?.id).toBe(next.id);
      });
      await reservation.rollbackTransaction();
      expect((await select())?.id).toBe(oldest.id);
    } finally {
      if (reservation.isTransactionActive)
        await reservation.rollbackTransaction();
      await reservation.release();
    }
  });

  it('does not wait for candidate user locks acquired by queue join', async () => {
    const opponent = await entry();
    const joining = source.createQueryRunner();
    await joining.connect();
    await joining.startTransaction();
    try {
      await joining.manager.findOneOrFail(User, {
        where: { id: opponent.userId },
        lock: { mode: 'pessimistic_write' },
      });
      await source.transaction(async (manager) => {
        await manager.query("SET LOCAL statement_timeout = '1500ms'");
        expect((await find(manager))?.id).toBe(opponent.id);
      });
    } finally {
      await joining.rollbackTransaction();
      await joining.release();
    }
  });
});
