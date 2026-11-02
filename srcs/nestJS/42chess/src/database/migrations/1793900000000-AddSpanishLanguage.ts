import type { MigrationInterface, QueryRunner } from 'typeorm';

const CHECK = (
  languages: string,
) => `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_preferences" CHECK (
      jsonb_typeof("preferences") = 'object'
      AND "preferences" ?& ARRAY['language','theme','soundEnabled','messagesFromFriendsOnly']
      AND jsonb_typeof("preferences"->'language') = 'string'
      AND jsonb_typeof("preferences"->'theme') = 'string'
      AND "preferences"->>'language' IN (${languages})
      AND "preferences"->>'theme' IN ('light','dark','system')
      AND jsonb_typeof("preferences"->'soundEnabled') = 'boolean'
      AND jsonb_typeof("preferences"->'messagesFromFriendsOnly') = 'boolean'
    )`;

/** The site is translated into Spanish too: the language preference accepts "es". */
export class AddSpanishLanguage1793900000000 implements MigrationInterface {
  name = 'AddSpanishLanguage1793900000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_preferences"`,
    );
    await runner.query(CHECK(`'en','fr','es'`));
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_preferences"`,
    );
    // Spanish speakers fall back to English, the default.
    await runner.query(
      `UPDATE "users" SET "preferences" = jsonb_set("preferences", '{language}', '"en"') WHERE "preferences"->>'language' = 'es'`,
    );
    await runner.query(CHECK(`'en','fr'`));
  }
}
