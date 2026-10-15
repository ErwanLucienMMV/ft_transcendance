import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTwoFactor1791822533387 implements MigrationInterface {
  name = 'AddTwoFactor1791822533387';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorSecret" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorEnabledAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorLastTimeStep" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorFailedAttempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorLockedUntil" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorLockedUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorFailedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorLastTimeStep"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorEnabledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorSecret"`,
    );
  }
}
