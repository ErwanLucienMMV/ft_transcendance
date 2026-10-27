import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOauthFlows1792800000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE TABLE oauth_flows (id varchar(64) PRIMARY KEY, "browserHash" varchar(64) NOT NULL, purpose varchar(16) NOT NULL CHECK (purpose IN ('authorize','handoff')), provider varchar(32) NOT NULL CHECK (provider IN ('google','github')), verifier varchar(128), "userId" uuid REFERENCES users(id) ON DELETE CASCADE, "sessionId" uuid REFERENCES auth_sessions(id) ON DELETE CASCADE, "expiresAt" timestamptz NOT NULL)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_oauth_flows_expiry" ON oauth_flows ("expiresAt")`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE oauth_flows');
  }
}
