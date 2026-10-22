import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-16 */
export class CreateRatingHistory1792000000005 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "rating_history" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "gameId" uuid NOT NULL, "ratingBefore" integer NOT NULL, "ratingAfter" integer NOT NULL, CONSTRAINT "FK_rating_history_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "FK_rating_history_gameId" FOREIGN KEY ("gameId") REFERENCES "games" (id) ON DELETE RESTRICT, CONSTRAINT "UQ_rating_history_0" UNIQUE ("userId", "gameId"), CONSTRAINT "CHK_rating_history_1" CHECK ("ratingBefore" >= 0 AND "ratingAfter" >= 0))`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "rating_history"`);
  }
}
