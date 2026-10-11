import { MigrationInterface, QueryRunner } from 'typeorm';

export class UsernameCaseInsensitiveUnique1791666799741 implements MigrationInterface {
  name = 'UsernameCaseInsensitiveUnique1791666799741';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fails if two existing usernames only differ by case: rename one first.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_username_lower" ON "users" (LOWER("username"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_users_username_lower"`);
  }
}
