import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-15 */
export class CreateGameMessage1792000000004 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "game_messages" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "gameId" uuid NOT NULL, "userId" uuid NOT NULL, "content" varchar(2000) NOT NULL, CONSTRAINT "FK_game_messages_gameId" FOREIGN KEY ("gameId") REFERENCES "games" (id) ON DELETE RESTRICT, CONSTRAINT "FK_game_messages_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "CHK_game_messages_0" CHECK (length(btrim("content")) > 0))`,
    );
    await runner.query(
      `CREATE INDEX "IDX_game_messages_history" ON "game_messages" ("gameId", "createdAt", id)`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "game_messages"`);
  }
}
