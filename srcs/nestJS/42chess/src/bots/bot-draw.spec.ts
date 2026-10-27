import { randomUUID } from 'node:crypto';
import { GameAgreementsService } from '../games/game-agreements.service.js';

describe('Draw offers against a bot', () => {
  it('rejects OFFER_DRAW before storing an offer', async () => {
    const actor = randomUUID(),
      id = randomUUID();
    const state = {
      game: { id, status: 'ACTIVE', drawOffer: null },
      players: [
        { userId: actor, color: 'WHITE', botDifficulty: null },
        { userId: null, color: 'BLACK', botDifficulty: 'EASY' },
      ],
      moves: [],
    };
    const save = vi.fn();
    const store = {
      locked: async (_id, action) => action({ save }, state),
      state: vi.fn(),
    };
    const clocks = { settle: async () => false };
    const service = new GameAgreementsService(store as never, clocks as never);
    await expect(service.offer(actor, id)).rejects.toMatchObject({
      code: 'BOT_DRAW_UNSUPPORTED',
    });
    expect(state.game.drawOffer).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
