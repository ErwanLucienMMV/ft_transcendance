import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-20 */
export class CreateDailyPuzzle1792000000008 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "daily_puzzles" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "puzzleId" uuid NOT NULL, "date" date NOT NULL, CONSTRAINT "FK_daily_puzzles_puzzleId" FOREIGN KEY ("puzzleId") REFERENCES "puzzles" (id) ON DELETE RESTRICT, CONSTRAINT "UQ_daily_puzzles_0" UNIQUE ("date"))`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "daily_puzzles"`);
  }
}
