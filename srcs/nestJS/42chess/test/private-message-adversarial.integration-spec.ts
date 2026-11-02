import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { User } from '../dist/users/user.entity.js';
import { Message } from '../dist/messages/messages.entity.js';
import { PrivateMessagesService } from '../dist/chat/private-messages.service.js';

// All migrations and writes are confined to a random, test-owned schema.
// Each test rolls back its own transaction; no pre-existing fixture rows are touched.
describe('SCRUM-249/252/253/254 adversarial PostgreSQL contracts', () => {
  const schema = `pm_audit_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource, runner: QueryRunner, service: PrivateMessagesService;
  let alice: User, bob: User, outsider: User;

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
  });
  beforeEach(async () => {
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    [alice, bob, outsider] = await runner.manager.getRepository(User).save(
      ['alice', 'bob', 'outsider'].map((name) => ({
        username: `audit_${name}`,
        emailVerifiedAt: new Date(),
      })),
    );
    service = new PrivateMessagesService(
      runner.manager.getRepository(Message),
      runner.manager.getRepository(User),
    );
  });
  afterEach(async () => {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    await runner?.release();
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
  const insert = (senderId: string, recipientId: string, content: unknown) =>
    runner.query(
      'INSERT INTO messages ("senderId", "recipientId", content) VALUES ($1,$2,$3) RETURNING *',
      [senderId, recipientId, content],
    );

  it.each(['\t\n\r', '\u00a0', '\u2003\u2028'])(
    'the model rejects whitespace-only content %j even when the service is bypassed',
    async (content) => {
      await expect(insert(alice.id, bob.id, content)).rejects.toMatchObject({
        driverError: { code: '23514' },
      });
    },
  );

  it.each(['\ud800', '\udc00', 'hello\ud800world'])(
    'rejects malformed Unicode %j instead of silently replacing content in PostgreSQL',
    async (content) => {
      await expect(
        service.send(alice.id, bob.id, content),
      ).rejects.toMatchObject({ status: 400 });
      expect(await runner.manager.getRepository(Message).count()).toBe(0);
    },
  );

  it.each(['', ' ', '\t\n\r', '\u00a0', '\u2003\u2028', '\ufeff'])(
    'the service rejects blank content %j without writes',
    async (content) => {
      await expect(
        service.send(alice.id, bob.id, content),
      ).rejects.toMatchObject({ status: 400 });
      expect(await runner.manager.getRepository(Message).count()).toBe(0);
    },
  );

  it.each([
    '😀'.repeat(2000),
    '  <script>alert("text")</script>\n♟️ e\u0301  ',
    '\ufffd',
  ])(
    'preserves valid Unicode and literal text exactly through storage',
    async (content) => {
      const saved = await service.send(alice.id, bob.id.toUpperCase(), content);
      const row = await runner.manager
        .getRepository(Message)
        .findOneByOrFail({ id: saved.id });
      expect(row.content).toBe(content);
      expect(row.readAt).toBeNull();
      expect(saved).toEqual({
        id: row.id,
        senderId: alice.id,
        receiverId: bob.id,
        content,
        createdAt: row.createdAt.toISOString(),
      });
      expect(
        (await service.history(bob.id, alice.id, { limit: 1, offset: 0 }))
          .messages,
      ).toEqual([saved]);
    },
  );

  it.each([
    ['empty', '', '23514'],
    ['spaces', '   ', '23514'],
    ['too long', 'a'.repeat(2001), '22001'],
    ['too many emoji', '😀'.repeat(2001), '22001'],
    ['null', null, '23502'],
  ])('the model rejects %s content', async (_name, content, code) => {
    await expect(insert(alice.id, bob.id, content)).rejects.toMatchObject({
      driverError: { code },
    });
  });

  it('the model rejects self messaging', async () => {
    await expect(insert(alice.id, alice.id, 'self')).rejects.toMatchObject({
      driverError: { code: '23514' },
    });
  });
  it.each(['sender', 'recipient'])(
    'the model rejects a nonexistent %s',
    async (missing) => {
      await expect(
        insert(
          missing === 'sender' ? randomUUID() : alice.id,
          missing === 'recipient' ? randomUUID() : bob.id,
          'orphan',
        ),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
    },
  );
  it('a message prevents deletion of its referenced account', async () => {
    await service.send(alice.id, bob.id, 'keep this history');
    await expect(
      runner.manager.getRepository(User).delete(bob.id),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('orders by full database timestamp precision and scopes both history directions to the actor', async () => {
    const rows = await runner.query(
      `INSERT INTO messages (id,"senderId","recipientId",content,"createdAt") VALUES
       ('ffffffff-ffff-4fff-8fff-ffffffffffff',$1,$2,'older','2026-10-01T12:00:00.000001Z'),
       ('00000000-0000-4000-8000-000000000001',$2,$1,'newer','2026-10-01T12:00:00.000002Z'),
       (uuid_generate_v4(),$3,$2,'unrelated','2026-10-02T12:00:00Z') RETURNING id`,
      [alice.id, bob.id, outsider.id],
    );
    const first = await service.history(alice.id, bob.id.toUpperCase(), {
      limit: 1,
      offset: 0,
    });
    const second = await service.history(bob.id, alice.id, {
      limit: 1,
      offset: 1,
    });
    expect(first).toMatchObject({
      total: 2,
      messages: [{ id: rows[1].id, content: 'newer' }],
    });
    expect(second).toMatchObject({
      total: 2,
      messages: [{ id: rows[0].id, content: 'older' }],
    });
    expect(
      await service.history(outsider.id, alice.id, { limit: 100, offset: 0 }),
    ).toEqual({ messages: [], total: 0, limit: 100, offset: 0 });
    expect(
      await service.history(alice.id, bob.id, {
        limit: 100,
        offset: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({
      messages: [],
      total: 2,
      limit: 100,
      offset: Number.MAX_SAFE_INTEGER,
    });
  });

  it('counts only unread incoming messages even when the latest message is outgoing', async () => {
    await service.send(bob.id, alice.id, 'already read');
    await runner.query('UPDATE messages SET "readAt" = now()');
    await service.send(bob.id, alice.id, 'unread');
    const latest = await service.send(alice.id, bob.id, 'outgoing');
    // Force the outgoing row to be newest independently of transaction timestamps.
    await runner.query(
      'UPDATE messages SET "createdAt" = now() + interval \'1 second\' WHERE id = $1',
      [latest.id],
    );
    await service.send(outsider.id, bob.id, 'must not leak');
    const conversations = await service.conversations(alice.id);
    expect(conversations.conversations).toHaveLength(1);
    expect(conversations.conversations[0]).toMatchObject({
      user: { id: bob.id, username: bob.username },
      lastMessage: { id: latest.id },
      unreadCount: 1,
    });
    await service.history(alice.id, bob.id, { limit: 100, offset: 0 });
    expect(await service.conversations(alice.id)).toEqual(conversations);
  });

  it('returns an empty conversation list for an account with no messages', async () => {
    await service.send(alice.id, bob.id, 'private');
    expect(await service.conversations(outsider.id)).toEqual({
      conversations: [],
    });
  });
});
