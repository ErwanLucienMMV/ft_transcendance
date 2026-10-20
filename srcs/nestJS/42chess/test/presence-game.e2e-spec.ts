import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { GamesService } from '../dist/games/games.service.js';
import { RatingService } from '../dist/rating/rating.service.js';
import { PresenceService } from '../dist/presence/presence.service.js';
import type { UserPresence } from '../dist/presence/presence.service.js';

describe('SCRUM-242 authoritative IN_GAME presence', () => {
  let app: INestApplication,
    source: DataSource,
    presence: PresenceService,
    games: GamesService;
  let users: User[] = [];
  const owned: string[] = [];
  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    games = app.get(GamesService);
  });
  beforeEach(async () => {
    users = await source
      .getRepository(User)
      .save(
        [0, 1, 2].map(() => ({
          username: `playing_${randomUUID().slice(0, 8)}`,
          emailVerifiedAt: new Date(),
        })),
      );
    for (const user of users) presence.connect(user.id, 'tab');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of owned.splice(0)) {
      await source.query('DELETE FROM rating_history WHERE "gameId"=$1', [id]);
      await source.query('DELETE FROM games WHERE id=$1', [id]);
    }
    for (const user of users) {
      presence.disconnect(user.id, 'tab');
      await source.getRepository(User).delete(user.id);
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  async function active(opponent = users[1]) {
    const { game } = await games.create(users[0].id, {
      initialTime: 300000,
      color: 'WHITE',
    });
    owned.push(game.id);
    await games.join(opponent.id, game.id);
    return game.id;
  }
  it('uses committed activation/completion while keeping waiting players ONLINE', async () => {
    const { game } = await games.create(users[0].id, {
      initialTime: 300000,
      color: 'WHITE',
    });
    owned.push(game.id);
    expect(presence.get(users[0].id).status).toBe('ONLINE');
    await games.join(users[1].id, game.id);
    for (const user of users.slice(0, 2))
      expect(presence.get(user.id).status).toBe('IN_GAME');
    expect(presence.get(users[2].id).status).toBe('ONLINE');
    await games.resign(users[1].id, game.id);
    for (const user of users)
      expect(presence.get(user.id).status).toBe('ONLINE');
  });
  it('keeps disconnected players OFFLINE and restores IN_GAME when they reconnect', async () => {
    const id = await active();
    presence.disconnect(users[0].id, 'tab');
    expect(presence.get(users[0].id).status).toBe('OFFLINE');
    presence.connect(users[0].id, 'tab');
    expect(presence.get(users[0].id).status).toBe('IN_GAME');
    await games.resign(users[1].id, id);
  });
  it('rebuilds active-game membership from PostgreSQL after a process restart', async () => {
    await active();
    const restored = new PresenceService(source);
    await restored.onModuleInit();
    expect(restored.get(users[0].id).status).toBe('OFFLINE');
    restored.connect(users[0].id, 'reconnected');
    expect(restored.get(users[0].id).status).toBe('IN_GAME');
  });
  it('does not publish ONLINE when a terminal transaction rolls back', async () => {
    const id = await active();
    const changes: UserPresence[] = [];
    const unsubscribe = presence.subscribe((state) => changes.push(state));
    try {
      vi.spyOn(
        app.get(RatingService),
        'applyFinishedGame',
      ).mockRejectedValueOnce(new Error('Injected rating failure'));
      await expect(games.resign(users[1].id, id)).rejects.toThrow(
        'Injected rating failure',
      );
      expect((await games.get(id)).game.status).toBe('ACTIVE');
      expect(presence.get(users[0].id).status).toBe('IN_GAME');
      expect(changes).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
  it('keeps IN_GAME until every active game for the account has finished', async () => {
    const first = await active(),
      second = await active(users[2]);
    await games.resign(users[1].id, first);
    expect(presence.get(users[0].id).status).toBe('IN_GAME');
    await games.resign(users[2].id, second);
    expect(presence.get(users[0].id).status).toBe('ONLINE');
  });
});
