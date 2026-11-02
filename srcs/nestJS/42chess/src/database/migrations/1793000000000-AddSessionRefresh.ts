import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive: sessions created before this migration simply cannot be refreshed. */
export class AddSessionRefresh1793000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE auth_sessions ADD COLUMN "refreshTokenHash" varchar(64), ADD COLUMN "previousRefreshTokenHash" varchar(64), ADD COLUMN "refreshRotatedAt" timestamptz`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE auth_sessions DROP COLUMN "refreshRotatedAt", DROP COLUMN "previousRefreshTokenHash", DROP COLUMN "refreshTokenHash"`,
    );
  }
}
