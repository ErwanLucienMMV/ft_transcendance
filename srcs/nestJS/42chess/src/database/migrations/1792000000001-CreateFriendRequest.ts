import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-12 */
export class CreateFriendRequest1792000000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "friend_requests" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "senderId" uuid NOT NULL, "recipientId" uuid NOT NULL, "status" varchar(8) NOT NULL DEFAULT 'PENDING', CONSTRAINT "FK_friend_requests_senderId" FOREIGN KEY ("senderId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "FK_friend_requests_recipientId" FOREIGN KEY ("recipientId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "CHK_friend_requests_0" CHECK ("senderId" <> "recipientId"), CONSTRAINT "CHK_friend_requests_1" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REJECTED')))`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX "UQ_friend_requests_pending_pair" ON "friend_requests" (LEAST("senderId", "recipientId"), GREATEST("senderId", "recipientId")) WHERE status = 'PENDING'`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "friend_requests"`);
  }
}
