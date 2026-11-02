import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { PresenceService } from './presence.service.js';
import { PresenceGateway } from './presence.gateway.js';

describe('Private presence delivery on shared authenticated connections', () => {
  it('revalidates recipients and excludes revoked, disconnected and unrelated connections', async () => {
    const subject = randomUUID(),
      friend = randomUUID(),
      outsider = randomUUID();
    const presence = new PresenceService();
    const source = { query: vi.fn(async () => [{ id: friend }]) };
    const gateway = new PresenceGateway(
      presence,
      source as unknown as DataSource,
    );
    gateway.onModuleInit();
    const valid = {
      userId: friend,
      connected: () => true,
      validate: vi.fn(async () => {}),
      send: vi.fn(),
    };
    const revoked = {
      ...valid,
      validate: vi.fn(async () => {
        throw new Error('revoked');
      }),
      send: vi.fn(),
    };
    const disconnected = { ...valid, connected: () => false, send: vi.fn() };
    const unrelated = { ...valid, userId: outsider, send: vi.fn() };
    gateway.connect('valid', valid);
    gateway.connect('revoked', revoked);
    gateway.connect('disconnected', disconnected);
    gateway.connect('unrelated', unrelated);
    await gateway.flushNotifications();
    for (const client of [valid, revoked, disconnected, unrelated])
      client.send.mockClear();
    presence.connect(subject, 'subject');
    await gateway.flushNotifications();
    expect(source.query).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM friendships'),
      [subject],
    );
    expect(valid.send).toHaveBeenCalledWith(
      'USER_ONLINE',
      expect.objectContaining({ userId: subject, status: 'ONLINE' }),
    );
    expect(revoked.send).not.toHaveBeenCalled();
    expect(disconnected.send).not.toHaveBeenCalled();
    expect(unrelated.send).not.toHaveBeenCalled();
    expect(valid.validate).toHaveBeenCalled();
    await gateway.onModuleDestroy();
  });

  it('tells every open page when a game starts or ends', async () => {
    const presence = new PresenceService();
    const gateway = new PresenceGateway(presence, {
      query: vi.fn(async () => []),
    } as unknown as DataSource);
    gateway.onModuleInit();
    const open = {
      userId: randomUUID(),
      connected: () => true,
      validate: vi.fn(async () => {}),
      send: vi.fn(),
    };
    const closed = { ...open, connected: () => false, send: vi.fn() };
    gateway.connect('open', open);
    gateway.connect('closed', closed);
    await gateway.flushNotifications();
    open.send.mockClear();
    const gameId = randomUUID();
    const player = randomUUID();
    presence.setGameStatus(gameId, [player], true);
    presence.setGameStatus(gameId, [player], false);
    await gateway.flushNotifications();
    expect(
      open.send.mock.calls.filter(([event]) => event === 'LIVE_GAMES_CHANGED'),
    ).toEqual([
      ['LIVE_GAMES_CHANGED', { gameId, active: true }],
      ['LIVE_GAMES_CHANGED', { gameId, active: false }],
    ]);
    expect(closed.send).not.toHaveBeenCalled();
    await gateway.onModuleDestroy();
  });
});
