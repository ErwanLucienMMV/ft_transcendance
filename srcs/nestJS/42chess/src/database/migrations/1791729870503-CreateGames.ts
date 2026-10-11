import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGames1791729870503 implements MigrationInterface {
  name = 'CreateGames1791729870503';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "games" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "status" character varying(8) NOT NULL DEFAULT 'WAITING',
        "initialFen" text NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        "currentFen" text NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        "turn" character varying(5) NOT NULL DEFAULT 'WHITE',
        "initialTime" integer NOT NULL,
        "increment" integer NOT NULL DEFAULT 0,
        "result" character varying(9),
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_games" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_games_status" CHECK ("status" IN ('WAITING', 'ACTIVE', 'FINISHED')),
        CONSTRAINT "CHK_games_turn" CHECK ("turn" IN ('WHITE', 'BLACK')),
        CONSTRAINT "CHK_games_time_control" CHECK ("initialTime" > 0 AND "increment" >= 0),
        CONSTRAINT "CHK_games_position" CHECK (length(btrim("initialFen")) > 0 AND length(btrim("currentFen")) > 0),
        CONSTRAINT "CHK_games_result" CHECK ("result" IN ('WHITE_WIN', 'BLACK_WIN', 'DRAW')),
        CONSTRAINT "CHK_games_lifecycle" CHECK (
          ("status" = 'WAITING' AND "startedAt" IS NULL AND "finishedAt" IS NULL AND "result" IS NULL)
          OR ("status" = 'ACTIVE' AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL AND "result" IS NULL)
          OR ("status" = 'FINISHED' AND "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "result" IS NOT NULL)
        ),
        CONSTRAINT "CHK_games_finish_time" CHECK ("finishedAt" >= "startedAt")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "game_players" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "gameId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "color" character varying(5) NOT NULL,
        "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_game_players" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_game_players_color" CHECK ("color" IN ('WHITE', 'BLACK')),
        CONSTRAINT "UQ_game_players_color" UNIQUE ("gameId", "color"),
        CONSTRAINT "UQ_game_players_user" UNIQUE ("gameId", "userId"),
        CONSTRAINT "FK_game_players_game" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_game_players_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "moves" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "gameId" uuid NOT NULL,
        "color" character varying(5) NOT NULL,
        "ply" integer NOT NULL,
        "uci" character varying(5) NOT NULL,
        "fenAfter" text NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_moves" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_moves_ply" UNIQUE ("gameId", "ply"),
        CONSTRAINT "CHK_moves_ply" CHECK ("ply" > 0),
        CONSTRAINT "CHK_moves_uci" CHECK ("uci" ~ '^[a-h][1-8][a-h][1-8][qrbn]?$' AND left("uci", 2) <> substring("uci", 3, 2)),
        CONSTRAINT "CHK_moves_position" CHECK (length(btrim("fenAfter")) > 0),
        CONSTRAINT "FK_moves_game" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_moves_player" FOREIGN KEY ("gameId", "color") REFERENCES "game_players"("gameId", "color") ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_games_status_createdAt" ON "games" ("status", "createdAt", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_games_createdAt" ON "games" ("createdAt", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_players_userId" ON "game_players" ("userId", "gameId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "moves"`);
    await queryRunner.query(`DROP TABLE "game_players"`);
    await queryRunner.query(`DROP TABLE "games"`);
  }
}
