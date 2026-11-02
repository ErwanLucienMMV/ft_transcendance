import type { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen migration expression: the whitespace removed by ECMAScript trim().
const nonblank = String.raw`length(btrim("content", U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0`;

export class CheckPrivateMessageContent1793392000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // NOT VALID enforces all new/updated rows while preserving historical data.
    // Keep the original constraint and migration intact.
    await runner.query(
      `ALTER TABLE messages ADD CONSTRAINT "CHK_messages_content_nonblank" CHECK (${nonblank}) NOT VALID`,
    );
    const [{ invalid }]: { invalid: boolean }[] = await runner.query(
      `SELECT EXISTS (SELECT 1 FROM messages WHERE NOT (${nonblank})) AS invalid`,
    );
    if (!invalid) {
      await runner.query(
        'ALTER TABLE messages VALIDATE CONSTRAINT "CHK_messages_content_nonblank"',
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE messages DROP CONSTRAINT "CHK_messages_content_nonblank"',
    );
  }
}
