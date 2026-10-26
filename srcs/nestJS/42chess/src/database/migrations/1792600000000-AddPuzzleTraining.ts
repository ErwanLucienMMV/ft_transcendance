import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Import provenance and resumable, optimistic puzzle sessions. Legacy rows remain readable. */
export class AddPuzzleTraining1792600000000 implements MigrationInterface {
  name = 'AddPuzzleTraining1792600000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE puzzles
      ADD COLUMN "sourceId" text UNIQUE,
      ADD COLUMN "sourceUrl" text,
      ADD COLUMN "sourceThemes" text[],
      ADD COLUMN "validatedAt" timestamptz`);
    await runner.query(`ALTER TABLE puzzle_attempts
      ADD COLUMN "currentFen" text,
      ADD COLUMN "version" integer NOT NULL DEFAULT 0,
      ADD CONSTRAINT "CHK_puzzle_attempts_version" CHECK (version >= 0)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE puzzle_attempts
      DROP CONSTRAINT "CHK_puzzle_attempts_version", DROP COLUMN version, DROP COLUMN "currentFen"`);
    await runner.query(`ALTER TABLE puzzles DROP COLUMN "validatedAt", DROP COLUMN "sourceThemes",
      DROP COLUMN "sourceUrl", DROP COLUMN "sourceId"`);
  }
}
