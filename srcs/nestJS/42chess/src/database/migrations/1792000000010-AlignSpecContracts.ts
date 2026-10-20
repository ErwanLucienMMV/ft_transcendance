import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-14/16/17/19/21: additive contract fields; never invent unknown historical metadata. */
export class AlignSpecContracts1792000000010 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE puzzles ADD COLUMN themes text[], ADD COLUMN "solutionMoves" jsonb,
      ADD CONSTRAINT "CHK_puzzles_themes" CHECK (themes <@ ARRAY['CHECK','CHECKMATE','FORK','PIN','SKEWER','DISCOVERED_ATTACK','MATE_IN_ONE','MATE_IN_TWO']::text[] AND array_position(themes, NULL) IS NULL),
      ADD CONSTRAINT "CHK_puzzles_solution_moves" CHECK ("solutionMoves" IS NULL OR (jsonb_typeof("solutionMoves") = 'array' AND jsonb_array_length("solutionMoves") > 0))`);
    await runner.query(`ALTER TABLE puzzle_attempts ADD COLUMN attempts integer, ADD COLUMN duration integer,
      ADD CONSTRAINT "CHK_puzzle_attempts_metrics" CHECK (attempts >= 0 AND duration >= 0)`);
    await runner.query(`ALTER TABLE matchmaking_queue ADD COLUMN status varchar(9) NOT NULL DEFAULT 'WAITING',
      ADD CONSTRAINT "CHK_matchmaking_status" CHECK (status IN ('WAITING','MATCHED','CANCELLED'))`);
    await runner.query(
      `CREATE INDEX "IDX_matchmaking_waiting" ON matchmaking_queue ("initialTime", increment, rating, "createdAt", id) WHERE status = 'WAITING'`,
    );
    await runner.query(`ALTER TABLE messages ADD COLUMN "readAt" timestamptz`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE messages DROP COLUMN "readAt"`);
    await runner.query(`DROP INDEX "IDX_matchmaking_waiting"`);
    await runner.query(
      `ALTER TABLE matchmaking_queue DROP CONSTRAINT "CHK_matchmaking_status", DROP COLUMN status`,
    );
    await runner.query(
      `ALTER TABLE puzzle_attempts DROP CONSTRAINT "CHK_puzzle_attempts_metrics", DROP COLUMN attempts, DROP COLUMN duration`,
    );
    await runner.query(
      `ALTER TABLE puzzles DROP CONSTRAINT "CHK_puzzles_solution_moves", DROP CONSTRAINT "CHK_puzzles_themes", DROP COLUMN "solutionMoves", DROP COLUMN themes`,
    );
  }
}
