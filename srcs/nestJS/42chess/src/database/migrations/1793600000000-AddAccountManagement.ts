import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account self-service: 2FA set-up and recovery codes, password reset, account deletion,
 * new OAuth accounts that the front invites to pick a username, and 42 sign-in.
 */
export class AddAccountManagement1793600000000 implements MigrationInterface {
  name = 'AddAccountManagement1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorPendingSecret" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorRecoveryCodes" text array`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "passwordResetTokenHash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_52f75ca69976d58d3ef5a45c06f" UNIQUE ("passwordResetTokenHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "passwordResetExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    // A deleted account keeps no way in: no email, password, second factor or reset link.
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_deleted" CHECK ("deletedAt" IS NULL OR ("email" IS NULL AND "passwordHash" IS NULL AND "twoFactorSecret" IS NULL AND "passwordResetTokenHash" IS NULL AND "emailVerifiedAt" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_flows" ADD "created" boolean NOT NULL DEFAULT false`,
    );
    // The 42 intranet joins Google and GitHub.
    await queryRunner.query(
      `ALTER TABLE "oauth_flows" DROP CONSTRAINT "oauth_flows_provider_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_flows" ADD CONSTRAINT "oauth_flows_provider_check" CHECK (provider IN ('google', 'github', 'fortytwo'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "oauth_flows" WHERE provider = 'fortytwo'`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_flows" DROP CONSTRAINT "oauth_flows_provider_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_flows" ADD CONSTRAINT "oauth_flows_provider_check" CHECK (provider IN ('google', 'github'))`,
    );
    await queryRunner.query(`ALTER TABLE "oauth_flows" DROP COLUMN "created"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_deleted"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "passwordResetExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_52f75ca69976d58d3ef5a45c06f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "passwordResetTokenHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorRecoveryCodes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorPendingSecret"`,
    );
  }
}
