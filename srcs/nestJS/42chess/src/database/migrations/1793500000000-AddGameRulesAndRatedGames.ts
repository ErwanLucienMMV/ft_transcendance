import type { MigrationInterface, QueryRunner } from 'typeorm';

const previousReasons = `'CHECKMATE', 'RESIGNATION', 'TIMEOUT', 'DRAW_AGREEMENT', 'STALEMATE', 'INSUFFICIENT_MATERIAL', 'THREEFOLD_REPETITION', 'FIFTY_MOVE_RULE'`;
const reasons = `${previousReasons}, 'FIVEFOLD_REPETITION', 'SEVENTY_FIVE_MOVE_RULE', 'ABANDONED', 'ABORTED'`;
const lifecycle = (finished: string) =>
  `("status" = 'WAITING' AND "startedAt" IS NULL AND "finishedAt" IS NULL AND "result" IS NULL)
   OR ("status" = 'ACTIVE' AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL AND "result" IS NULL)
   OR ("status" = 'FINISHED' AND "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND ${finished})`;

/**
 * Rated and casual games, the automatic draws (fivefold repetition and the
 * seventy-five-move rule), abandoned and aborted games, and the draw offer
 * cooldown. Existing human games keep the rating they already had.
 */
export class AddGameRulesAndRatedGames1793500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE games
      ADD "rated" boolean NOT NULL DEFAULT true,
      ADD "whiteDrawOfferPly" integer,
      ADD "blackDrawOfferPly" integer,
      ADD CONSTRAINT "CHK_games_draw_offer_plies" CHECK (("whiteDrawOfferPly" IS NULL OR "whiteDrawOfferPly" >= 0) AND ("blackDrawOfferPly" IS NULL OR "blackDrawOfferPly" >= 0))`);
    // Bot games never changed anyone's rating.
    await runner.query(`UPDATE games g SET "rated" = false WHERE EXISTS (
      SELECT 1 FROM game_players p WHERE p."gameId" = g.id AND p."botDifficulty" IS NOT NULL)`);
    await runner.query(`ALTER TABLE games
      DROP CONSTRAINT "CHK_games_end_reason",
      ADD CONSTRAINT "CHK_games_end_reason" CHECK ("endReason" IS NULL OR ("status" = 'FINISHED' AND "endReason" IN (${reasons}))),
      DROP CONSTRAINT "CHK_games_lifecycle",
      ADD CONSTRAINT "CHK_games_lifecycle" CHECK (${lifecycle(`("result" IS NOT NULL OR "endReason" IS NOT DISTINCT FROM 'ABORTED')`)}),
      ADD CONSTRAINT "CHK_games_aborted" CHECK ("endReason" IS DISTINCT FROM 'ABORTED' OR "result" IS NULL)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Aborted games have no result and cannot satisfy the previous constraints.
    await runner.query(
      `DELETE FROM game_messages WHERE "gameId" IN (SELECT id FROM games WHERE "endReason" = 'ABORTED')`,
    );
    await runner.query(`DELETE FROM games WHERE "endReason" = 'ABORTED'`);
    await runner.query(
      `UPDATE games SET "endReason" = 'THREEFOLD_REPETITION' WHERE "endReason" = 'FIVEFOLD_REPETITION'`,
    );
    await runner.query(
      `UPDATE games SET "endReason" = 'FIFTY_MOVE_RULE' WHERE "endReason" = 'SEVENTY_FIVE_MOVE_RULE'`,
    );
    await runner.query(
      `UPDATE games SET "endReason" = 'RESIGNATION' WHERE "endReason" = 'ABANDONED'`,
    );
    await runner.query(`ALTER TABLE games
      DROP CONSTRAINT "CHK_games_aborted",
      DROP CONSTRAINT "CHK_games_lifecycle",
      ADD CONSTRAINT "CHK_games_lifecycle" CHECK (${lifecycle(`"result" IS NOT NULL`)}),
      DROP CONSTRAINT "CHK_games_end_reason",
      ADD CONSTRAINT "CHK_games_end_reason" CHECK ("endReason" IS NULL OR ("status" = 'FINISHED' AND "endReason" IN (${previousReasons}))),
      DROP CONSTRAINT "CHK_games_draw_offer_plies",
      DROP COLUMN "blackDrawOfferPly",
      DROP COLUMN "whiteDrawOfferPly",
      DROP COLUMN "rated"`);
  }
}
