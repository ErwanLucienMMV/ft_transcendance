import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameAgreements1791740100000 implements MigrationInterface {
  name = 'AddGameAgreements1791740100000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "games"
      ADD "drawOffer" varchar(5),
      ADD "endReason" varchar(24),
      ADD CONSTRAINT "CHK_games_draw_offer" CHECK ("drawOffer" IS NULL OR ("status" = 'ACTIVE' AND "drawOffer" IN ('WHITE', 'BLACK'))),
      ADD CONSTRAINT "CHK_games_end_reason" CHECK ("endReason" IS NULL OR ("status" = 'FINISHED' AND "endReason" IN ('CHECKMATE', 'RESIGNATION', 'TIMEOUT', 'DRAW_AGREEMENT', 'STALEMATE', 'INSUFFICIENT_MATERIAL', 'THREEFOLD_REPETITION', 'FIFTY_MOVE_RULE')))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE "games" DROP COLUMN "drawOffer", DROP COLUMN "endReason"`,
    );
  }
}
