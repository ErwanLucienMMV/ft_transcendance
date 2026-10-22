import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-13 */
export class CreateFriendship1792000000002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "friendships" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "friendId" uuid NOT NULL, CONSTRAINT "FK_friendships_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "FK_friendships_friendId" FOREIGN KEY ("friendId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "CHK_friendships_0" CHECK ("userId" < "friendId"), CONSTRAINT "UQ_friendships_1" UNIQUE ("userId", "friendId"))`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "friendships"`);
  }
}
