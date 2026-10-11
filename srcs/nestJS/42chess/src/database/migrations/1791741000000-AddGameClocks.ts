import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameClocks1791741000000 implements MigrationInterface {
  name = 'AddGameClocks1791741000000';
  async up(runner: QueryRunner): Promise<void> {
    // Earlier releases did not record elapsed time. Inventing remaining time for
    // a live game would change its outcome; apply between games instead.
    await runner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM games WHERE status='ACTIVE') THEN
      RAISE EXCEPTION 'Finish active games before enabling persistent clocks'; END IF; END $$`);
    await runner.query(`ALTER TABLE games ADD clock jsonb, ADD "clockDeadline" timestamptz,
      ADD CONSTRAINT "CHK_games_clock" CHECK (clock IS NULL OR jsonb_typeof(clock)='object'),
      ADD CONSTRAINT "CHK_games_clock_deadline" CHECK ("clockDeadline" IS NULL OR status='ACTIVE')`);
    await runner.query(
      `UPDATE games SET clock=jsonb_build_object('white',"initialTime",'black',"initialTime",'activeColor',NULL,'expiredColor',NULL,'status','WAITING','updatedAt',0) WHERE status='WAITING'`,
    );
    await runner.query(
      `CREATE INDEX "IDX_games_clock_deadline" ON games ("clockDeadline",id) WHERE status='ACTIVE'`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX "IDX_games_clock_deadline"`);
    await runner.query(
      `ALTER TABLE games DROP COLUMN clock, DROP COLUMN "clockDeadline"`,
    );
  }
}
