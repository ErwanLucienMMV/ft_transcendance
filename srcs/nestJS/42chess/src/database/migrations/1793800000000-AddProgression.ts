import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Experience, levels, the daily puzzle streak and achievements, plus the puzzle
 * attempt limits (mistakes, hint, revealed solution). Achievements are seeded here;
 * see docs/progression.md for the rules.
 */
export class AddProgression1793800000000 implements MigrationInterface {
  name = 'AddProgression1793800000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "user_progress" ("userId" uuid NOT NULL, "xp" integer NOT NULL DEFAULT 0, "puzzleStreak" integer NOT NULL DEFAULT 0, "bestPuzzleStreak" integer NOT NULL DEFAULT 0, "lastStreakDate" date, "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_user_progress" PRIMARY KEY ("userId"), CONSTRAINT "CHK_user_progress_counts" CHECK ("xp" >= 0 AND "puzzleStreak" >= 0 AND "bestPuzzleStreak" >= "puzzleStreak"), CONSTRAINT "FK_user_progress_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE CASCADE)`,
    );
    await runner.query(
      `CREATE TABLE "xp_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "source" varchar(12) NOT NULL, "refId" varchar(64) NOT NULL, "amount" integer NOT NULL, CONSTRAINT "PK_xp_events" PRIMARY KEY ("id"), CONSTRAINT "UQ_xp_events_award" UNIQUE ("userId", "source", "refId"), CONSTRAINT "CHK_xp_events_source" CHECK ("source" IN ('GAME', 'PUZZLE', 'ACHIEVEMENT')), CONSTRAINT "CHK_xp_events_amount" CHECK ("amount" > 0), CONSTRAINT "FK_xp_events_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE CASCADE)`,
    );
    await runner.query(
      `CREATE TABLE "achievements" ("code" varchar(32) NOT NULL, "position" integer NOT NULL, "name" varchar(64) NOT NULL, "description" varchar(200) NOT NULL, "metric" varchar(24) NOT NULL, "goal" integer NOT NULL, "xp" integer NOT NULL, CONSTRAINT "PK_achievements" PRIMARY KEY ("code"), CONSTRAINT "CHK_achievements_values" CHECK ("goal" > 0 AND "xp" >= 0), CONSTRAINT "CHK_achievements_metric" CHECK ("metric" IN ('HUMAN_GAMES', 'HUMAN_WINS', 'BOT_EASY_WINS', 'BOT_MEDIUM_WINS', 'BOT_HARD_WINS', 'PUZZLES_SOLVED', 'PUZZLE_STREAK', 'RATING', 'LEVEL')))`,
    );
    await runner.query(
      `CREATE TABLE "user_achievements" ("userId" uuid NOT NULL, "code" varchar(32) NOT NULL, "unlockedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_user_achievements" PRIMARY KEY ("userId", "code"), CONSTRAINT "FK_user_achievements_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE CASCADE, CONSTRAINT "FK_user_achievements_code" FOREIGN KEY ("code") REFERENCES "achievements" ("code") ON DELETE CASCADE)`,
    );
    await runner.query(`INSERT INTO "achievements"
      ("code", "position", "name", "description", "metric", "goal", "xp") VALUES
      ('FIRST_GAME', 1, 'Opening move', 'Finish your first game against another player.', 'HUMAN_GAMES', 1, 10),
      ('FIRST_WIN', 2, 'First victory', 'Win a game against another player.', 'HUMAN_WINS', 1, 20),
      ('GAMES_10', 3, 'Regular', 'Finish 10 games against other players.', 'HUMAN_GAMES', 10, 30),
      ('GAMES_50', 4, 'Veteran', 'Finish 50 games against other players.', 'HUMAN_GAMES', 50, 75),
      ('WINS_25', 5, 'Conqueror', 'Win 25 games against other players.', 'HUMAN_WINS', 25, 75),
      ('BOT_EASY', 6, 'Warm-up', 'Beat the easy computer.', 'BOT_EASY_WINS', 1, 10),
      ('BOT_MEDIUM', 7, 'Sparring partner', 'Beat the medium computer.', 'BOT_MEDIUM_WINS', 1, 25),
      ('BOT_HARD', 8, 'Machine slayer', 'Beat the hard computer.', 'BOT_HARD_WINS', 1, 50),
      ('PUZZLE_FIRST', 9, 'Puzzle solver', 'Solve your first puzzle.', 'PUZZLES_SOLVED', 1, 10),
      ('PUZZLES_25', 10, 'Tactician', 'Solve 25 puzzles.', 'PUZZLES_SOLVED', 25, 50),
      ('STREAK_3', 11, 'On a roll', 'Solve the daily puzzle 3 days in a row.', 'PUZZLE_STREAK', 3, 20),
      ('STREAK_7', 12, 'Week of tactics', 'Solve the daily puzzle 7 days in a row.', 'PUZZLE_STREAK', 7, 50),
      ('RATING_1400', 13, 'Climber', 'Reach a rating of 1400.', 'RATING', 1400, 50),
      ('LEVEL_5', 14, 'Rising star', 'Reach level 5.', 'LEVEL', 5, 0)`);
    await runner.query(`ALTER TABLE "puzzle_attempts"
      ADD "mistakes" integer NOT NULL DEFAULT 0,
      ADD "hintUsed" boolean NOT NULL DEFAULT false,
      ADD "revealed" boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT "CHK_puzzle_attempts_mistakes" CHECK ("mistakes" >= 0)`);
    // Tries that were not accepted: every submission minus the solver's accepted moves.
    await runner.query(`UPDATE "puzzle_attempts"
      SET "mistakes" = GREATEST(0, "attempts" - (cardinality("moves") + 1) / 2)
      WHERE "attempts" IS NOT NULL`);
    await runner.query(
      `CREATE INDEX "IDX_daily_puzzles_puzzleId" ON "daily_puzzles" ("puzzleId")`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX "IDX_daily_puzzles_puzzleId"`);
    await runner.query(`ALTER TABLE "puzzle_attempts"
      DROP CONSTRAINT "CHK_puzzle_attempts_mistakes",
      DROP COLUMN "revealed", DROP COLUMN "hintUsed", DROP COLUMN "mistakes"`);
    await runner.query(`DROP TABLE "user_achievements"`);
    await runner.query(`DROP TABLE "achievements"`);
    await runner.query(`DROP TABLE "xp_events"`);
    await runner.query(`DROP TABLE "user_progress"`);
  }
}
