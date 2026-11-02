import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { CheckPrivateMessageContent1793392000000 } from '../dist/database/migrations/1793392000000-CheckPrivateMessageContent.js';
import { User } from '../dist/users/user.entity.js';
import { Message } from '../dist/messages/messages.entity.js';

describe('Private-message whitespace constraint and forward upgrade', () => {
  const schema = `pm_constraint_${randomUUID().replaceAll('-', '')}`;
  const migration = new CheckPrivateMessageContent1793392000000();
  let source: DataSource;
  let sender: User, receiver: User;
  // Explicit ECMAScript WhiteSpace and LineTerminator characters, including
  // cases that depend on locale when PostgreSQL POSIX character classes are used.
  const whitespace = [
    '\u0009',
    '\u000a',
    '\u000b',
    '\u000c',
    '\u000d',
    '\u0020',
    '\u00a0',
    '\u1680',
    '\u2000',
    '\u2001',
    '\u2002',
    '\u2003',
    '\u2004',
    '\u2005',
    '\u2006',
    '\u2007',
    '\u2008',
    '\u2009',
    '\u200a',
    '\u2028',
    '\u2029',
    '\u202f',
    '\u205f',
    '\u3000',
    '\ufeff',
  ];
  beforeAll(async () => {
    const options = cliDataSource.options;
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    source = new DataSource({
      ...options,
      schema,
      entities: [User, Message],
      extra: { ...options.extra, options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.query(`CREATE SCHEMA "${schema}"`);
    await source.runMigrations();
    [sender, receiver] = await source
      .getRepository(User)
      .save([
        { username: 'constraint_sender' },
        { username: 'constraint_receiver' },
      ]);
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

  it.each(whitespace)(
    'rejects trim-only content %j in direct database writes',
    async (blank) => {
      expect(blank.trim()).toBe('');
      await expect(
        source.query(
          'INSERT INTO messages ("senderId", "recipientId", content) VALUES ($1,$2,$3)',
          [sender.id, receiver.id, blank],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    },
  );

  it('allows visible content surrounded by every whitespace and characters outside the trim policy', async () => {
    for (const content of [
      whitespace.join('') + 'hello' + whitespace.join(''),
      '\u0085',
      '\u200b',
      '\ufffd',
      '😀',
    ]) {
      expect(content.trim()).not.toBe('');
      const [{ content: stored }]: { content: string }[] = await source.query(
        'INSERT INTO messages ("senderId", "recipientId", content) VALUES ($1,$2,$3) RETURNING content',
        [sender.id, receiver.id, content],
      );
      expect(stored).toBe(content);
    }
  });

  it.each([false, true])(
    'preserves existing rows when legacy blank content is present: %s',
    async (legacyBlank) => {
      // Exercise the actual forward migration against a pre-upgrade table, entirely
      // inside a rollback-only transaction in this test's private schema.
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await migration.down(runner);
        const content = legacyBlank
          ? '\t\u00a0\ufeff'
          : 'preserve this exact message';
        const [before] = await runner.query(
          'INSERT INTO messages ("senderId", "recipientId", content) VALUES ($1,$2,$3) RETURNING *',
          [sender.id, receiver.id, content],
        );
        await migration.up(runner);
        const [after] = await runner.query(
          'SELECT * FROM messages WHERE id = $1',
          [before.id],
        );
        expect(after).toEqual(before);
        const [{ convalidated }] = await runner.query(
          `SELECT convalidated FROM pg_constraint WHERE conrelid = 'messages'::regclass AND conname = 'CHK_messages_content_nonblank'`,
        );
        expect(convalidated).toBe(!legacyBlank);
        const [{ original }] = await runner.query(
          `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'messages'::regclass AND conname = 'CHK_messages_1') AS original`,
        );
        expect(original).toBe(true);
        await expect(
          runner.query(
            'INSERT INTO messages ("senderId", "recipientId", content) VALUES ($1,$2,$3)',
            [sender.id, receiver.id, '\n\t'],
          ),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    },
  );
});
