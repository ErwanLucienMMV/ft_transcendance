import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-05 DB-06 */
export class CreateOauthAccount1792000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE "oauth_accounts" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "createdAt" timestamptz NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "provider" varchar(32) NOT NULL, "providerUserId" varchar(255) NOT NULL, CONSTRAINT "FK_oauth_accounts_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) ON DELETE RESTRICT, CONSTRAINT "UQ_oauth_accounts_0" UNIQUE ("provider", "providerUserId"), CONSTRAINT "CHK_oauth_accounts_1" CHECK (length(btrim("provider")) > 0 AND length(btrim("providerUserId")) > 0))`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE "oauth_accounts"`);
  }
}
