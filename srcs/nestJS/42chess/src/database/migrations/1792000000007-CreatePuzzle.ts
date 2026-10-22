import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-19 */
export class CreatePuzzle1792000000007 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "puzzles" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "fen" text NOT NULL, "solution" text[] NOT NULL, "rating" integer NOT NULL DEFAULT 1200, CONSTRAINT "CHK_puzzles_0" CHECK (length(btrim("fen")) > 0), CONSTRAINT "CHK_puzzles_1" CHECK (cardinality("solution") > 0 AND array_position("solution", NULL) IS NULL), CONSTRAINT "CHK_puzzles_2" CHECK ("rating" >= 0))`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "puzzles"`);
  }
}
