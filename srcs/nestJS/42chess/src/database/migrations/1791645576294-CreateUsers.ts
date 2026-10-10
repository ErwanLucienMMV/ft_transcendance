import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1791645576294 implements MigrationInterface {
  name = 'CreateUsers1791645576294';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying(32) NOT NULL, "email" character varying(254), "passwordHash" character varying(255), "avatarUrl" character varying(2048), "elo" integer NOT NULL DEFAULT '1200', "gamesPlayed" integer NOT NULL DEFAULT '0', "gamesWon" integer NOT NULL DEFAULT '0', "gamesDraw" integer NOT NULL DEFAULT '0', "gamesLost" integer NOT NULL DEFAULT '0', "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
