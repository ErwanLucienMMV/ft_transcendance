import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddBotSeats1792278000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE game_players
      ALTER COLUMN "userId" DROP NOT NULL,
      ADD COLUMN "botDifficulty" varchar(6),
      ADD CONSTRAINT "CHK_game_players_kind" CHECK (
        ("userId" IS NOT NULL AND "botDifficulty" IS NULL) OR
        ("userId" IS NULL AND "botDifficulty" IS NOT NULL AND "botDifficulty" IN ('EASY','MEDIUM','HARD'))
      )`);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		// Refuse to destroy bot game history on rollback.
		await queryRunner.query(
			`ALTER TABLE game_players ALTER COLUMN "userId" SET NOT NULL`,
		);
		await queryRunner.query(`ALTER TABLE game_players
      DROP CONSTRAINT "CHK_game_players_kind", DROP COLUMN "botDifficulty"`);
	}
}
