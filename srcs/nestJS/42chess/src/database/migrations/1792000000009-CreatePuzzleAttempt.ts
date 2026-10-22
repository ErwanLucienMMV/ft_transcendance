import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-21 */
export class CreatePuzzleAttempt1792000000009 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "puzzle_attempts" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "puzzleId" uuid NOT NULL, "solved" boolean NOT NULL DEFAULT false, "moves" text[] NOT NULL DEFAULT '{}', CONSTRAINT "FK_puzzle_attempts_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "FK_puzzle_attempts_puzzleId" FOREIGN KEY ("puzzleId") REFERENCES "puzzles" (id) ON DELETE RESTRICT, CONSTRAINT "CHK_puzzle_attempts_0" CHECK (array_position("moves", NULL) IS NULL))`,
    );
    await runner.query(
      `CREATE INDEX "IDX_puzzle_attempts_user" ON "puzzle_attempts" ("userId", "puzzleId", "createdAt")`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "puzzle_attempts"`);
  }
}
