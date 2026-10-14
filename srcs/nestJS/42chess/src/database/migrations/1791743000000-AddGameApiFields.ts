import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameApiFields1791743000000 implements MigrationInterface {
  name = 'AddGameApiFields1791743000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE games ADD "invitedOpponentId" uuid,
      ADD CONSTRAINT "FK_games_invited_opponent" FOREIGN KEY ("invitedOpponentId") REFERENCES users(id) ON DELETE RESTRICT`);
    await runner.query(
      `CREATE INDEX "IDX_games_invited_opponent" ON games ("invitedOpponentId")`,
    );
    await runner.query(`ALTER TABLE moves ADD notation varchar(16)`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE moves DROP COLUMN notation`);
    await runner.query(`DROP INDEX "IDX_games_invited_opponent"`);
    await runner.query(`ALTER TABLE games DROP COLUMN "invitedOpponentId"`);
  }
}
