import { GameError } from './game-error.js';
import type { GameState } from './game-state.js';
import type { GamePlayer } from './game-player.entity.js';
import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import type { Game, GameEndReason, GameResult } from './game.entity.js';

export function activePlayer(state: GameState, actor: string): GamePlayer {
  const player = participatingPlayer(state, actor);
  if (player.color !== state.game.turn)
    throw new GameError(
      'WRONG_TURN',
      'Only the player whose turn it is can act.',
    );
  return player;
}

/** Agreement and resignation do not require it to be the actor's turn. */
export function participatingPlayer(
  state: GameState,
  actor: string,
): GamePlayer {
import type { GameResult } from './game.entity.js';

export function activePlayer(state: GameState, actor: string): GamePlayer {
  const player = participatingPlayer(state, actor);
  if (player.color !== state.game.turn)
    throw new GameError(
      'WRONG_TURN',
      'Only the player whose turn it is can act.',
    );
  return player;
}

/** Agreement and resignation do not require it to be the actor's turn. */
export function participatingPlayer(
  state: GameState,
  actor: string,
): GamePlayer {
  if (state.game.status === 'FINISHED')
    throw new GameError(
      'GAME_ALREADY_FINISHED',
      'This game has already finished.',
    );
  if (state.game.status !== 'ACTIVE')
    throw new GameError('GAME_NOT_ACTIVE', 'This game is not active.');
  const player = state.players.find((seat) => seat.userId === actor);
  if (!player)
    throw new GameError('NOT_A_PLAYER', 'Only a player of this game can act.');
  return player;
}

export function finishGame(
  game: Game,
  result: GameResult,
  reason: GameEndReason,
): void {
  game.status = 'FINISHED';
  game.result = result;
  game.endReason = reason;
  game.finishedAt = new Date();
  game.drawOffer = null;
}

  if (player.color !== state.game.turn)
    throw new GameError(
      'WRONG_TURN',
      'Only the player whose turn it is can act.',
    );
  return player;
}

export function finishGame(
  game: Game,
  result: GameResult,
  reason: GameEndReason,
): void {
  game.status = 'FINISHED';
  game.result = result;
  game.endReason = reason;
  game.finishedAt = new Date();
  game.drawOffer = null;
}

/** Claimable draws are handled separately; they do not finish a game automatically. */
export function automaticResult(snapshot: ChessSnapshot): GameResult | null {
  switch (snapshot.status) {
    case 'checkmate':
      return snapshot.winner === 'white' ? 'WHITE_WIN' : 'BLACK_WIN';
    case 'stalemate':
    case 'insufficient_material':
      return 'DRAW';
    case 'ongoing':
      return null;
  }
}
