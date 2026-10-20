import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPreferences1792500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "preferences" jsonb NOT NULL
      DEFAULT '{"language":"en","theme":"system","soundEnabled":true}'::jsonb`);
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_preferences" CHECK (
      jsonb_typeof("preferences") = 'object'
      AND "preferences" ?& ARRAY['language','theme','soundEnabled']
      AND jsonb_typeof("preferences"->'language') = 'string'
      AND jsonb_typeof("preferences"->'theme') = 'string'
      AND "preferences"->>'language' IN ('en','fr')
      AND "preferences"->>'theme' IN ('light','dark','system')
      AND jsonb_typeof("preferences"->'soundEnabled') = 'boolean'
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN "preferences"');
  }
}
