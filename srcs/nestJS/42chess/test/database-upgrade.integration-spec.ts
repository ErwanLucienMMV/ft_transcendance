import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { CheckedDataSource } from '../dist/database/database-preflight.js';
import { User } from '../dist/users/user.entity.js';
import { Message } from '../dist/messages/messages.entity.js';

const upgradeName = 'CheckPrivateMessageContent1793392000000';

describe('Upgrade from the previous private-message schema', () => {
  it.each([false, true])(
    'preserves stored rows and Unicode bytes across startup (legacy blank: %s)',
    async (legacyBlank) => {
      const options = cliDataSource.options;
      if (options.type !== 'postgres') throw new Error('PostgreSQL required');
      const schema = `upgrade_${randomUUID().replaceAll('-', '')}`;
      const fixtureOptions = {
        ...options,
        schema,
        entities: [User, Message],
        extra: { ...options.extra, options: `-c search_path=${schema},public` },
      };
      const previous = new DataSource(fixtureOptions);
      const upgraded = new CheckedDataSource({
        ...fixtureOptions,
        migrationsRun: true,
      });
      try {
        await previous.initialize();
        await previous.query(`CREATE SCHEMA "${schema}"`);
        // Apply the actual preceding chain and record its migration history.
        // Unlike rolling one constraint back, this exercises a forward startup.
        expect(
          previous.migrations.some(
            (m) => (m.name ?? m.constructor.name) === upgradeName,
          ),
        ).toBe(true);
        const precedingMigrations = previous.migrations.filter(
          (m) =>
            Number((m.name ?? m.constructor.name).slice(-13)) < 1793392000000,
        );
        previous.migrations.splice(
          0,
          previous.migrations.length,
          ...precedingMigrations,
        );
        expect((await previous.runMigrations()).length).toBeGreaterThan(0);
        const [sender, receiver] = await previous
          .getRepository(User)
          .save([
            { username: 'upgrade_sender' },
            { username: 'upgrade_receiver' },
          ]);
        const contents = ['Hello', 'échec ♟ 😀', '\u00a0\u2003visible\ufeff'];
        if (legacyBlank) contents.push('\t\u00a0\ufeff');
        for (const content of contents) {
          await previous.getRepository(Message).save({
            senderId: sender.id,
            recipientId: receiver.id,
            content,
          });
        }
        const snapshot = () =>
          `SELECT *, encode(convert_to(content, 'UTF8'), 'hex') AS "contentBytes"
           FROM messages ORDER BY id`;
        const before = await previous.query(snapshot());
        const usersBefore = await previous.query(
          'SELECT * FROM users ORDER BY id',
        );
        const historyBefore = await previous.query(
          'SELECT * FROM typeorm_migrations ORDER BY id',
        );
        await previous.destroy();

        // This is the same automatic-migration path used by Nest startup.
        await upgraded.initialize();
        expect(await upgraded.query(snapshot())).toEqual(before);
        expect(await upgraded.query('SELECT * FROM users ORDER BY id')).toEqual(
          usersBefore,
        );
        const historyAfter = await upgraded.query(
          'SELECT * FROM typeorm_migrations ORDER BY id',
        );
        expect(historyAfter.slice(0, -1)).toEqual(historyBefore);
        expect(historyAfter.at(-1).name).toBe(upgradeName);
        expect(historyAfter).toHaveLength(historyBefore.length + 1);
        expect(await upgraded.showMigrations()).toBe(false);
        expect(await upgraded.runMigrations()).toEqual([]);
        const [{ convalidated }] = await upgraded.query(
          `SELECT convalidated FROM pg_constraint
           WHERE conrelid = 'messages'::regclass
             AND conname = 'CHK_messages_content_nonblank'`,
        );
        expect(convalidated).toBe(!legacyBlank);
        await expect(
          upgraded.getRepository(Message).save({
            senderId: sender.id,
            recipientId: receiver.id,
            content: '\u00a0\ufeff',
          }),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });
      } finally {
        if (previous.isInitialized) await previous.destroy();
        // The failed-initialization path closes its pool; cleanup connects anew.
        if (!upgraded.isInitialized) {
          upgraded.setOptions({ migrationsRun: false });
          await upgraded.initialize();
        }
        try {
          await upgraded.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await upgraded.destroy();
        }
      }
    },
  );
});
