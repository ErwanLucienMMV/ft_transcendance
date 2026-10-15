import { Injectable } from '@nestjs/common';
import { Game } from './game.entity.js';
import { GameStoreService } from './game-store.service.js';
import { GameError } from './game-error.js';
import { identifier } from './game-input.js';
import { finishGame, participatingPlayer } from './game-actions.js';
import type { GameState } from './game-state.js';
import { GameClocksService } from './clock/game-clocks.service.js';

@Injectable()
export class GameAgreementsService {
  constructor(
    private readonly store: GameStoreService,
    private readonly clocks: GameClocksService,
  ) {}

  offer(actor: string, id: string): Promise<GameState> {
    return this.act(actor, id, (state, color) => {
      if (state.game.drawOffer !== null)
        throw new GameError(
          'DRAW_ALREADY_OFFERED',
          'A draw offer is already pending.',
        );
      state.game.drawOffer = color;
    });
  }

  respond(actor: string, id: string, accept: boolean): Promise<GameState> {
    return this.act(actor, id, (state, color) => {
      if (state.game.drawOffer === null)
        throw new GameError('DRAW_NOT_OFFERED', 'No draw offer is pending.');
      if (state.game.drawOffer === color)
        throw new GameError(
          'OWN_DRAW_OFFER',
          'Only the opponent can respond to an offer.',
        );
      if (accept) finishGame(state.game, 'DRAW', 'DRAW_AGREEMENT');
      else state.game.drawOffer = null;
    });
  }

  resign(actor: string, id: string): Promise<GameState> {
    return this.act(actor, id, (state, color) => {
      finishGame(
        state.game,
        color === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN',
        'RESIGNATION',
      );
    });
  }

  private act(
    actor: string,
    id: string,
    action: (state: GameState, color: 'WHITE' | 'BLACK') => void,
  ): Promise<GameState> {
    const userId = identifier(actor);
    return this.store.locked(identifier(id), async (manager, state) => {
      const player = participatingPlayer(state, userId);
      if (!(await this.clocks.settle(manager, state.game))) {
        action(state, player.color);
        if (state.game.status === 'FINISHED') this.clocks.stop(state.game);
      }
      await manager.save(Game, state.game);
      return this.store.state(manager, state.game);
    });
  }
}
