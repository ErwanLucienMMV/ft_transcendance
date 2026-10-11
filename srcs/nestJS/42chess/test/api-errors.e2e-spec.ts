import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { GameError } from '../dist/games/game-error.js';

@Controller('error-fixture')
class ErrorFixtureController {
  @Get('bad') bad() {
    throw new BadRequestException('Invalid request');
  }
  @Get('auth') auth() {
    throw new UnauthorizedException();
  }
  @Get('coded') coded() {
    throw new ConflictException({
      statusCode: 409,
      code: 'USERNAME_ALREADY_EXISTS',
      message: 'Username already exists',
    });
  }
  @Get('unexpected') unexpected() {
    throw new Error(
      'postgres://password@private-server SELECT secret FROM users',
    );
  }
  @Get('wrong-turn') turn() {
    throw new GameError('WRONG_TURN', 'Only the active player can act.');
  }
  @Get('invalid-move') move() {
    throw new GameError('ILLEGAL_MOVE', 'The move is not legal.');
  }
  @Get('missing-game') missing() {
    throw new GameError('GAME_NOT_FOUND', 'Game does not exist.');
  }
  @Get('finished-game') finished() {
    throw new GameError(
      'GAME_ALREADY_FINISHED',
      'This game has already finished.',
    );
  }
  @Get('invalid-engine') engine() {
    throw new GameError(
      'INVALID_ENGINE_RESPONSE',
      'Secret engine response dump',
    );
  }
  @Get('override-status') overrideStatus() {
    throw new HttpException(
      { statusCode: 200, code: 'BAD_REQUEST', message: 'Invalid request' },
      400,
    );
  }
}

describe('Global API error contract', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrorFixtureController],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it.each([
    ['bad', 400, 'BAD_REQUEST'],
    ['auth', 401, 'AUTH_REQUIRED'],
    ['missing-route', 404, 'NOT_FOUND'],
    ['wrong-turn', 409, 'NOT_YOUR_TURN'],
    ['invalid-move', 400, 'INVALID_MOVE'],
    ['missing-game', 404, 'GAME_NOT_FOUND'],
    ['finished-game', 409, 'GAME_ALREADY_FINISHED'],
  ])('maps %s to its public code/status', async (path, statusCode, code) => {
    const response = await request(app.getHttpServer())
      .get(`/error-fixture/${path}`)
      .expect(statusCode as number);
    expect(response.body).toMatchObject({
      statusCode,
      code,
      message: expect.any(String),
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'code',
      'message',
      'statusCode',
    ]);
  });
  it('preserves the error envelope already used by auth', async () => {
    const response = await request(app.getHttpServer())
      .get('/error-fixture/coded')
      .expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      code: 'USERNAME_ALREADY_EXISTS',
      message: 'Username already exists',
    });
  });
  it.each([
    ['unexpected', 500, 'INTERNAL_SERVER_ERROR'],
    ['invalid-engine', 502, 'INVALID_ENGINE_RESPONSE'],
  ])('masks %s internals', async (path, statusCode, code) => {
    const response = await request(app.getHttpServer())
      .get(`/error-fixture/${path}`)
      .expect(statusCode as number);
    expect(response.body).toMatchObject({ statusCode, code });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|private-server|SELECT|Secret|stack/,
    );
  });
  it('uses the HTTP exception status instead of a contradictory payload status', async () => {
    const response = await request(app.getHttpServer())
      .get('/error-fixture/override-status')
      .expect(400);
    expect(response.body.statusCode).toBe(400);
  });
});
