import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-14 */
export class CreateMessage1792000000003 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "messages" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "senderId" uuid NOT NULL, "recipientId" uuid NOT NULL, "content" varchar(2000) NOT NULL, CONSTRAINT "FK_messages_senderId" FOREIGN KEY ("senderId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "FK_messages_recipientId" FOREIGN KEY ("recipientId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "CHK_messages_0" CHECK ("senderId" <> "recipientId"), CONSTRAINT "CHK_messages_1" CHECK (length(btrim("content")) > 0))`,
    );
    await runner.query(
      `CREATE INDEX "IDX_messages_conversation" ON "messages" ("senderId", "recipientId", "createdAt", id)`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "messages"`);
  }
}
