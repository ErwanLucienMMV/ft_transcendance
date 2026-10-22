import { randomUUID } from 'node:crypto';
import { GamePresenterService } from '../games/game-presenter.service.js';
import type { GameState } from '../games/game-state.js';

describe('Public bot turn status', () => {
  const source = { getRepository: () => ({ find: async () => [] }) };
  const presenter = new GamePresenterService(source as never);
  function state(): GameState {
    return {
      game: {
        id: randomUUID(),
        status: 'ACTIVE',
        turn: 'WHITE',
        currentFen: '7k/8/8/8/8/8/P7/K7 w - - 0 1',
        botLeaseToken: null,
        botLeaseUntil: null,
        botError: 'BOT_UNAVAILABLE',
        createdAt: new Date(),
        startedAt: new Date(),
        clock: null,
        drawOffer: null,
        result: null,
        initialTime: 300000,
        increment: 0,
      },
      players: [
        {
          id: randomUUID(),
          userId: null,
          botDifficulty: 'EASY',
          color: 'WHITE',
        },
      ],
      moves: [],
    } as unknown as GameState;
  }
  it('publishes a pending/retryable state without exposing lease tokens', async () => {
    const pending = state();
    const response = await presenter.state(pending);
    expect(response).toMatchObject({
      botPending: true,
      botThinking: false,
      botError: 'BOT_UNAVAILABLE',
    });
    expect(JSON.stringify(response)).not.toMatch(/botLease/);
    pending.game.botLeaseToken = randomUUID();
    pending.game.botLeaseUntil = new Date(Date.now() + 45000);
    expect((await presenter.state(pending)).botThinking).toBe(true);
    pending.game.botLeaseUntil = new Date(0);
    expect((await presenter.state(pending)).botThinking).toBe(false);
  });
  it('never reports a pending bot after the game has finished or the turn changed', async () => {
    const done = state();
    done.game.status = 'FINISHED';
    expect((await presenter.state(done)).botPending).toBe(false);
    done.game.status = 'ACTIVE';
    done.game.turn = 'BLACK';
    expect((await presenter.state(done)).botPending).toBe(false);
  });
});
