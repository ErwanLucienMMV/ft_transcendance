import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
const options = cliDataSource.options;
if (options.type !== 'postgres') throw new Error('PostgreSQL required');
const postgresOptions = options;
import type { Message } from '../dist/messages/messages.entity.js';
import { countUnread } from '../dist/messages/message-presenter.js';
import type { MatchmakingEntry } from '../dist/matchmaking/matchmaking-queue.entity.js';

describe('spec contract migration and persisted fields', () => {
  const schema = `contracts_${randomUUID().replaceAll('-', '')}`;
  const alice = randomUUID(),
    bob = randomUUID(),
    outsider = randomUUID();
  let source: DataSource;
  beforeAll(async () => {
    const admin = new DataSource({ ...postgresOptions, migrations: [] });
    await admin.initialize();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await admin.destroy();
    }
    source = new DataSource({
      ...postgresOptions,
      schema,
      extra: { options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
    await source.query(
      `INSERT INTO users(id,username) VALUES ($1,'alice'),($2,'bob'),($3,'outsider')`,
      [alice, bob, outsider],
    );
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
  it('upgrades legacy rows without rewriting their data or inventing solution/attempt metadata', async () => {
    await source.undoLastMigration();
    const [{ id: puzzleId }] = await source.query(
      `INSERT INTO puzzles(fen,solution) VALUES ('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',ARRAY['f7g7']) RETURNING id`,
    );
    await source.query(
      `INSERT INTO puzzle_attempts("userId","puzzleId",moves) VALUES ($1,$2,ARRAY['f7g7'])`,
      [alice, puzzleId],
    );
    await source.query(
      `INSERT INTO matchmaking_queue("userId",rating,"initialTime") VALUES ($1,1200,600000)`,
      [alice],
    );
    expect(await source.runMigrations()).toHaveLength(1);
    const [puzzle] = await source.query('SELECT * FROM puzzles WHERE id=$1', [
      puzzleId,
    ]);
    expect(puzzle.solution).toEqual(['f7g7']);
    expect(puzzle.themes).toBeNull();
    expect(puzzle.solutionMoves).toBeNull();
    const [attempt] = await source.query(
      'SELECT * FROM puzzle_attempts WHERE "puzzleId"=$1',
      [puzzleId],
    );
    expect(attempt.moves).toEqual(['f7g7']);
    expect(attempt.attempts).toBeNull();
    expect(attempt.duration).toBeNull();
    expect(
      (
        await source.query(
          'SELECT status FROM matchmaking_queue WHERE "userId"=$1',
          [alice],
        )
      )[0].status,
    ).toBe('WAITING');
  });
  it('persists themes and rejects unknown tags, negative metrics and invalid queue statuses', async () => {
    const [{ id }] = await source.query(
      `INSERT INTO puzzles(fen,solution,themes) VALUES ('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',ARRAY['f7g7'],ARRAY['MATE_IN_ONE']) RETURNING id`,
    );
    await expect(
      source.query(`UPDATE puzzles SET themes=ARRAY['UNKNOWN'] WHERE id=$1`, [
        id,
      ]),
    ).rejects.toThrow();
    await expect(
      source.query(
        `UPDATE puzzles SET "solutionMoves"='{}'::jsonb WHERE id=$1`,
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      source.query(
        `INSERT INTO puzzle_attempts("userId","puzzleId",attempts,duration) VALUES ($1,$2,-1,1000)`,
        [alice, id],
      ),
    ).rejects.toThrow();
    await expect(
      source.query(
        `INSERT INTO puzzle_attempts("userId","puzzleId",attempts,duration) VALUES ($1,$2,1,-1)`,
        [alice, id],
      ),
    ).rejects.toThrow();
    await source.query(
      `INSERT INTO puzzle_attempts("userId","puzzleId",attempts,duration) VALUES ($1,$2,3,1500)`,
      [alice, id],
    );
    await expect(
      source.query(
        `UPDATE matchmaking_queue SET status='INVALID' WHERE "userId"=$1`,
        [alice],
      ),
    ).rejects.toThrow();
  });
  it('retains terminal queue states and can requeue the same user without duplicate active entries', async () => {
    for (const status of ['MATCHED', 'CANCELLED', 'WAITING']) {
      await source.query(
        'UPDATE matchmaking_queue SET status=$2 WHERE "userId"=$1',
        [alice, status],
      );
      const row = await source
        .getRepository<MatchmakingEntry>('MatchmakingEntry')
        .findOneByOrFail({ userId: alice });
      expect(row.status).toBe(status);
      expect(row.elo).toBe(1200);
      expect(row.timeControl.initialTime).toBe(600000);
      expect(row.joinedAt).toBeInstanceOf(Date);
    }
    await expect(
      source.query(
        `INSERT INTO matchmaking_queue("userId",rating,"initialTime") VALUES ($1,1200,600000)`,
        [alice],
      ),
    ).rejects.toThrow();
    const [index] = await source.query(
      'SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',
      [schema, 'IDX_matchmaking_waiting'],
    );
    expect(index.indexdef).toContain("'WAITING'");
  });
  it('counts only unread incoming messages from the requested sender', async () => {
    await source.query(
      `INSERT INTO messages("senderId","recipientId",content,"readAt") VALUES ($1,$2,'unread',NULL),($1,$2,'already read',now()),($2,$1,'outgoing',NULL),($3,$2,'another sender',NULL)`,
      [alice, bob, outsider],
    );
    const repository = source.getRepository<Message>('Message');
    expect(await countUnread(repository, bob, alice)).toBe(1);
    await source.query(
      `UPDATE messages SET "readAt"=now() WHERE "senderId"=$1 AND "recipientId"=$2`,
      [alice, bob],
    );
    expect(await countUnread(repository, bob, alice)).toBe(0);
    expect(await countUnread(repository, bob, outsider)).toBe(1);
  });
});
