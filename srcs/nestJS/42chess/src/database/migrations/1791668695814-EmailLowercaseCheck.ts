import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailLowercaseCheck1791668695814 implements MigrationInterface {
  name = 'EmailLowercaseCheck1791668695814';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_lowercase" CHECK ("email" = LOWER("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_email_lowercase"`,
    );
  }
}
