import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-17 DB-18 */
export class CreateMatchmakingEntry1792000000006 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "matchmaking_queue" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "rating" integer NOT NULL, "initialTime" integer NOT NULL, "increment" integer NOT NULL DEFAULT 0, CONSTRAINT "FK_matchmaking_queue_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "UQ_matchmaking_queue_0" UNIQUE ("userId"), CONSTRAINT "CHK_matchmaking_queue_1" CHECK ("rating" >= 0 AND "initialTime" > 0 AND "increment" >= 0))`,
    );
    await runner.query(
      `CREATE INDEX "IDX_matchmaking_lookup" ON "matchmaking_queue" ("initialTime", "increment", rating, "createdAt", id)`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "matchmaking_queue"`);
  }
}
