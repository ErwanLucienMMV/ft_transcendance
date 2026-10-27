import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSessions1792800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE auth_sessions (id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, "expiresAt" timestamptz NOT NULL, "revokedAt" timestamptz)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_auth_sessions_userId" ON auth_sessions ("userId")`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE auth_sessions');
  }
}
