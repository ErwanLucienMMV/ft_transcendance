import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable recovery of the exact game assigned by a completed queue cycle. */
export class AddMatchmakingGame1793208000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE matchmaking_matches (
      "gameId" uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      "matchedAt" timestamptz NOT NULL,
      "whiteWaitSeconds" double precision NOT NULL CHECK ("whiteWaitSeconds" >= 0),
      "blackWaitSeconds" double precision NOT NULL CHECK ("blackWaitSeconds" >= 0))`);
    await runner.query(`ALTER TABLE matchmaking_queue
      ADD COLUMN "matchedGameId" uuid NULL,
      ADD COLUMN "matchedAt" timestamptz NULL,
      ADD CONSTRAINT "FK_matchmaking_game" FOREIGN KEY ("matchedGameId") REFERENCES games(id) ON DELETE SET NULL`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE matchmaking_matches`);
    await runner.query(`ALTER TABLE matchmaking_queue DROP CONSTRAINT "FK_matchmaking_game",
      DROP COLUMN "matchedAt", DROP COLUMN "matchedGameId"`);
  }
}
