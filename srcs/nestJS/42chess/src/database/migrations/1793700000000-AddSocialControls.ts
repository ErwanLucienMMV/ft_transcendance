import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Blocking, a pause before a declined friend request can be sent again, and the
 * "only friends can message or challenge me" preference.
 */
export class AddSocialControls1793700000000 implements MigrationInterface {
  name = 'AddSocialControls1793700000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "user_blocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "blockerId" uuid NOT NULL, "blockedId" uuid NOT NULL, CONSTRAINT "PK_user_blocks" PRIMARY KEY ("id"), CONSTRAINT "UQ_user_blocks_pair" UNIQUE ("blockerId", "blockedId"), CONSTRAINT "CHK_user_blocks_self" CHECK ("blockerId" <> "blockedId"), CONSTRAINT "FK_user_blocks_blockerId" FOREIGN KEY ("blockerId") REFERENCES "users" (id) ON DELETE CASCADE, CONSTRAINT "FK_user_blocks_blockedId" FOREIGN KEY ("blockedId") REFERENCES "users" (id) ON DELETE CASCADE)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_user_blocks_blockedId" ON "user_blocks" ("blockedId")`,
    );
    await runner.query(
      `ALTER TABLE "friend_requests" ADD "resolvedAt" timestamptz`,
    );
    await runner.query(
      `UPDATE "friend_requests" SET "resolvedAt" = "createdAt" WHERE status <> 'PENDING'`,
    );
    await runner.query(
      `UPDATE "users" SET "preferences" = '{"messagesFromFriendsOnly":false}'::jsonb || "preferences"`,
    );
    await runner.query(
      `ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"language":"en","theme":"system","soundEnabled":true,"messagesFromFriendsOnly":false}'::jsonb`,
    );
    await runner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_preferences"`,
    );
    await runner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_preferences" CHECK (
      jsonb_typeof("preferences") = 'object'
      AND "preferences" ?& ARRAY['language','theme','soundEnabled','messagesFromFriendsOnly']
      AND jsonb_typeof("preferences"->'language') = 'string'
      AND jsonb_typeof("preferences"->'theme') = 'string'
      AND "preferences"->>'language' IN ('en','fr')
      AND "preferences"->>'theme' IN ('light','dark','system')
      AND jsonb_typeof("preferences"->'soundEnabled') = 'boolean'
      AND jsonb_typeof("preferences"->'messagesFromFriendsOnly') = 'boolean'
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_preferences"`,
    );
    await runner.query(
      `UPDATE "users" SET "preferences" = "preferences" - 'messagesFromFriendsOnly'`,
    );
    await runner.query(
      `ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"language":"en","theme":"system","soundEnabled":true}'::jsonb`,
    );
    await runner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_preferences" CHECK (
      jsonb_typeof("preferences") = 'object'
      AND "preferences" ?& ARRAY['language','theme','soundEnabled']
      AND jsonb_typeof("preferences"->'language') = 'string'
      AND jsonb_typeof("preferences"->'theme') = 'string'
      AND "preferences"->>'language' IN ('en','fr')
      AND "preferences"->>'theme' IN ('light','dark','system')
      AND jsonb_typeof("preferences"->'soundEnabled') = 'boolean'
    )`);
    await runner.query(
      `ALTER TABLE "friend_requests" DROP COLUMN "resolvedAt"`,
    );
    await runner.query(`DROP TABLE "user_blocks"`);
  }
}
