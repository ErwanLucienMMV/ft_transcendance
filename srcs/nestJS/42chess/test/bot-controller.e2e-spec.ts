import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { BotsController } from '../dist/bots/bots.controller.js';
import { GamesService } from '../dist/games/games.service.js';
import { GamePresenterService } from '../dist/games/game-presenter.service.js';
import { GameActorGuard } from '../dist/games/game-actor.guard.js';
import { GameError } from '../dist/games/game-error.js';
import { createValidationPipe } from '../dist/common/validation.js';
import { apiError } from '../dist/common/api-error.js';

// Real Nest HTTP pipeline, DTOs, guard and controller; domain/DB covered separately.
describe('Bot controller HTTP contract', () => {
  let app: INestApplication<App>;
  const actor = randomUUID(),
    gameId = randomUUID();
  const state = { game: { id: gameId, status: 'ACTIVE' }, moves: [] };
  const pending = {
    id: gameId,
    status: 'ACTIVE',
    botPending: true,
    botThinking: false,
    botError: 'BOT_UNAVAILABLE',
  };
  const games = { createBot: vi.fn(), resumeBot: vi.fn(), play: vi.fn() };
  const presenter = { state: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BotsController],
      providers: [
        GameActorGuard,
        { provide: GamesService, useValue: games },
        { provide: GamePresenterService, useValue: presenter },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        req: Request & { user?: { id: string } },
        _res: Response,
        next: NextFunction,
      ) => {
        if (req.headers.authorization === 'Bearer fixture')
          req.user = { id: actor };
        next();
      },
    );
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters({
      catch(error, host) {
        const result = apiError(error);
        host
          .switchToHttp()
          .getResponse()
          .status(result.statusCode)
          .json(result);
      },
    });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    games.createBot.mockResolvedValue(state);
    games.resumeBot.mockResolvedValue(state);
    games.play.mockResolvedValue(state);
    presenter.state.mockResolvedValue(pending);
  });
  const payload = {
    difficulty: 'MEDIUM',
    color: 'BLACK',
    timeControl: { initialTime: 300000, increment: 2000 },
  };
  it('creates a Black-human game and returns the service result including bot readiness', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/games/bot')
      .set('Authorization', 'Bearer fixture')
      .send(payload)
      .expect(201);
    expect(response.body).toMatchObject({ gameId, ...pending });
    expect(games.createBot).toHaveBeenCalledWith(
      actor,
      { initialTime: 300000, increment: 2000, color: 'BLACK' },
      'MEDIUM',
    );
  });
  it('returns a successful accepted-player response when the bot remains pending', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/games/${gameId}/bot/player-move`)
      .set('Authorization', 'Bearer fixture')
      .send({ uci: 'e2e4' })
      .expect(201);
    expect(response.body.botPending).toBe(true);
    expect(response.body.botError).toBe('BOT_UNAVAILABLE');
    expect(games.play).toHaveBeenCalledWith(actor, gameId, 'e2e4');
  });
  it('routes an explicit retry and preserves the pending response', async () => {
    await request(app.getHttpServer())
      .post(`/v1/games/${gameId}/bot-move`)
      .set('Authorization', 'Bearer fixture')
      .expect(201);
    expect(games.resumeBot).toHaveBeenCalledWith(actor, gameId);
  });
  it.each(['bot', `${gameId}/bot-move`, `${gameId}/bot/player-move`])(
    'rejects anonymous or forged actors for %s',
    async (path) => {
      await request(app.getHttpServer())
        .post(`/v1/games/${path}`)
        .set('Authorization', `Bearer ${actor}`)
        .send(payload)
        .expect(401);
      expect(games.createBot).not.toHaveBeenCalled();
      expect(games.play).not.toHaveBeenCalled();
      expect(games.resumeBot).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...payload, difficulty: 'EXPERT' },
    { ...payload, userId: randomUUID() },
    { ...payload, timeControl: { initialTime: 0, increment: 0 } },
    { ...payload, color: 'RED' },
  ])('rejects invalid creation DTO %j', async (input) => {
    await request(app.getHttpServer())
      .post('/v1/games/bot')
      .set('Authorization', 'Bearer fixture')
      .send(input)
      .expect(400);
    expect(games.createBot).not.toHaveBeenCalled();
  });
  it('rejects invalid UUIDs and malformed UCI before invoking the game service', async () => {
    await request(app.getHttpServer())
      .post('/v1/games/nope/bot-move')
      .set('Authorization', 'Bearer fixture')
      .expect(400);
    await request(app.getHttpServer())
      .post(`/v1/games/${gameId}/bot/player-move`)
      .set('Authorization', 'Bearer fixture')
      .send({ uci: 'bad' })
      .expect(400);
    expect(games.play).not.toHaveBeenCalled();
    expect(games.resumeBot).not.toHaveBeenCalled();
  });
  it('maps the active-game cap to an explicit 409 rather than an internal error', async () => {
    games.createBot.mockRejectedValue(
      new GameError('BOT_GAME_LIMIT', 'Finish your current bot game.'),
    );
    const response = await request(app.getHttpServer())
      .post('/v1/games/bot')
      .set('Authorization', 'Bearer fixture')
      .send(payload)
      .expect(409);
    expect(response.body.code).toBe('BOT_GAME_LIMIT');
  });
});
