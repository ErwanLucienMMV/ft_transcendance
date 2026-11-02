import { describe, expect, it } from 'vitest';
import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import { canCheckmate, mandatoryDraw } from './game-actions.js';
import { isAllowedTimeControl, TIME_CONTROLS } from './time-controls.js';

function snapshot(fen: string, repetitionCount = 1): ChessSnapshot {
  return {
    fen,
    turn: fen.split(' ')[1] === 'w' ? 'white' : 'black',
    check: false,
    checkmate: false,
    stalemate: false,
    insufficientMaterial: false,
    status: 'ongoing',
    winner: null,
    repetitionCount,
    threefoldClaimable: repetitionCount >= 3,
    fiftyMoveClaimable: false,
    legalMoves: [],
  };
}

describe('mandatory draws (FIDE 9.6)', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it('ends the game at the fifth repetition, not before', () => {
    expect(mandatoryDraw(snapshot(start, 4))).toBeNull();
    expect(mandatoryDraw(snapshot(start, 5))).toBe('FIVEFOLD_REPETITION');
  });
  it('ends the game after seventy-five moves without capture or pawn move', () => {
    const fen = (clock: number) => `8/8/4k3/8/8/4K3/8/R7 w - - ${clock} 120`;
    expect(mandatoryDraw(snapshot(fen(149)))).toBeNull();
    expect(mandatoryDraw(snapshot(fen(150)))).toBe('SEVENTY_FIVE_MOVE_RULE');
  });
  it('lets a checkmate on that move stand', () => {
    const mate = {
      ...snapshot('8/8/8/8/8/5k2/8/5K1r w - - 150 120', 5),
      checkmate: true,
      status: 'checkmate' as const,
      winner: 'black' as const,
    };
    expect(mandatoryDraw(mate)).toBeNull();
  });
});

describe('a flag fall against a side that cannot checkmate (FIDE 6.9)', () => {
  it.each([
    ['a lone king', '8/8/4k3/8/8/4K3/8/8 w - - 0 1', 'WHITE', false],
    ['a king and a knight', '8/8/4k3/8/8/4K3/8/6N1 w - - 0 1', 'WHITE', false],
    ['a king and a bishop', '8/8/4k3/8/8/4K3/8/5B2 w - - 0 1', 'WHITE', false],
    [
      'bishops on one colour',
      '8/8/4k3/8/8/4K3/8/B1B5 w - - 0 1',
      'WHITE',
      false,
    ],
    [
      'bishops on both colours',
      '8/8/4k3/8/8/4K3/8/B4B2 w - - 0 1',
      'WHITE',
      true,
    ],
    ['two knights', '8/8/4k3/8/8/4K3/8/1N4N1 w - - 0 1', 'WHITE', true],
    ['a pawn', '8/8/4k3/8/8/4K3/P7/8 w - - 0 1', 'WHITE', true],
    ['a rook for Black', '8/8/4k3/8/8/4K3/8/r7 w - - 0 1', 'BLACK', true],
    [
      'a knight against a defender with pieces',
      '8/8/4k3/8/3p4/4K3/8/6N1 w - - 0 1',
      'WHITE',
      true,
    ],
  ] as const)('%s', (_label, fen, color, expected) => {
    expect(canCheckmate(fen, color)).toBe(expected);
  });
});

describe('time controls offered by the front', () => {
  it('accepts exactly the listed controls', () => {
    for (const control of TIME_CONTROLS)
      expect(isAllowedTimeControl({ ...control })).toBe(true);
    expect(isAllowedTimeControl({ initialTime: 60_000, increment: 0 })).toBe(
      false,
    );
    expect(isAllowedTimeControl({ initialTime: 300_000 })).toBe(false);
    expect(isAllowedTimeControl(null)).toBe(false);
  });
});
