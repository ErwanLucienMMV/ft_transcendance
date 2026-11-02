import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMatchmakingLease1793350000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Existing waiting entries receive one grace period during deployment.
    await runner.query(`ALTER TABLE matchmaking_queue ADD COLUMN "leaseExpiresAt"
      timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 seconds')`);
    await runner.query(`CREATE INDEX "IDX_matchmaking_expiry"
      ON matchmaking_queue ("leaseExpiresAt") WHERE status = 'WAITING'`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX "IDX_matchmaking_expiry"');
    await runner.query(
      'ALTER TABLE matchmaking_queue DROP COLUMN "leaseExpiresAt"',
    );
  }
}
