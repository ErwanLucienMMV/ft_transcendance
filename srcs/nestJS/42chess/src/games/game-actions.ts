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

/** `result` is null only for an aborted game, which has neither winner nor draw. */
export function finishGame(
  game: Game,
  result: GameResult | null,
  reason: GameEndReason,
): void {
  game.botLeaseToken = null;
  game.botLeaseUntil = null;
  game.botError = null;
  game.status = 'FINISHED';
  game.result = result;
  game.endReason = reason;
  game.finishedAt = new Date();
  game.drawOffer = null;
}

/**
 * FIDE 9.6: the game is drawn without a claim once the same position appeared five
 * times, or after seventy-five moves by each side without a capture or a pawn move.
 * Checkmate on that move takes precedence and is handled by automaticResult.
 */
export function mandatoryDraw(
  snapshot: ChessSnapshot,
): 'FIVEFOLD_REPETITION' | 'SEVENTY_FIVE_MOVE_RULE' | null {
  if (snapshot.status !== 'ongoing') return null;
  if (snapshot.repetitionCount >= 5) return 'FIVEFOLD_REPETITION';
  const halfmoveClock = Number(snapshot.fen.split(' ')[4]);
  return halfmoveClock >= 150 ? 'SEVENTY_FIVE_MOVE_RULE' : null;
}

/**
 * FIDE 6.9: a player whose flag falls loses, unless the opponent cannot checkmate
 * by any series of legal moves; the game is then drawn. This recognizes the cases
 * that matter in practice and errs towards a win when in doubt: a lone king, a
 * king and one minor piece, or a king and bishops on one colour, facing a lone king.
 */
export function canCheckmate(fen: string, color: 'WHITE' | 'BLACK'): boolean {
  const placement = fen.split(' ')[0];
  const own = color === 'WHITE' ? /[PNBRQ]/g : /[pnbrq]/g;
  const theirs = color === 'WHITE' ? /[pnbrq]/g : /[PNBRQ]/g;
  const pieces = placement.match(own) ?? [];
  if (pieces.length === 0) return false;
  if (pieces.some((piece) => /[prq]/i.test(piece))) return true;
  // Only knights and bishops are left: mating needs help from the other side's pieces.
  if ((placement.match(theirs) ?? []).length > 0) return true;
  if (pieces.length === 1) return false;
  if (pieces.some((piece) => /n/i.test(piece))) return true;
  const shades = new Set(bishopShades(placement, color));
  return shades.size > 1;
}

function bishopShades(placement: string, color: 'WHITE' | 'BLACK'): number[] {
  const bishop = color === 'WHITE' ? 'B' : 'b';
  const shades: number[] = [];
  placement.split('/').forEach((row, rank) => {
    let file = 0;
    for (const square of row) {
      if (/\d/.test(square)) file += Number(square);
      else {
        if (square === bishop) shades.push((rank + file) % 2);
        file++;
      }
    }
  });
  return shades;
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
