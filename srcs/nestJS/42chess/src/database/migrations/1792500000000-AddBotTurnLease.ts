import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddBotTurnLease1792500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE games
      ADD COLUMN "botLeaseToken" uuid,
      ADD COLUMN "botLeaseUntil" timestamptz,
      ADD COLUMN "botError" varchar(24),
      ADD CONSTRAINT "CHK_games_bot_lease" CHECK (
        ("botLeaseToken" IS NULL AND "botLeaseUntil" IS NULL) OR
        ("botLeaseToken" IS NOT NULL AND "botLeaseUntil" IS NOT NULL AND status = 'ACTIVE'))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE games DROP CONSTRAINT "CHK_games_bot_lease",
      DROP COLUMN "botError", DROP COLUMN "botLeaseUntil", DROP COLUMN "botLeaseToken"`);
  }
}
