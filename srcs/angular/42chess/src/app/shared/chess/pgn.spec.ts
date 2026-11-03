import type { GameMove } from '../../core/realtime/game-realtime';
import { spokenMove } from './game-text';
import { gamePgn, pgnResult } from './pgn';

const move = (number: number, from: string, to: string, notation: string | null, fen: string) =>
  ({ number, playerId: 'p', from, to, notation, fen, timestamp: '' }) as GameMove;

describe('PGN export', () => {
  const game = {
    id: 'g1',
    whitePlayer: {
      id: 'a',
      username: 'alice',
      avatarUrl: null,
      elo: 1210,
      color: 'WHITE' as const,
    },
    blackPlayer: {
      id: 'b',
      username: 'Bot HARD',
      avatarUrl: null,
      elo: null,
      color: 'BLACK' as const,
      botDifficulty: 'HARD' as const,
    },
    rated: false,
    timeControl: { initialTime: 180_000, increment: 2_000 },
    result: { winner: 'WHITE' as const, reason: 'CHECKMATE' },
    startedAt: '2026-11-02T18:00:00.000Z',
    createdAt: '2026-11-02T17:59:00.000Z',
  };

  it('writes the tags and the moves, filling in notation missing from old games', () => {
    const pgn = gamePgn(game, [
      move(1, 'e2', 'e4', 'e4', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
      move(2, 'g8', 'f6', null, 'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2'),
    ]);
    expect(pgn).toBe(
      [
        '[Event "Casual game"]',
        '[Site "42 Chess"]',
        '[Date "2026.11.02"]',
        '[Round "-"]',
        '[White "alice"]',
        '[Black "Computer (hard)"]',
        '[Result "1-0"]',
        '[WhiteElo "1210"]',
        '[TimeControl "180+2"]',
        '[Termination "normal"]',
        '[GameId "g1"]',
        '',
        '1. e4 Nf6 1-0',
        '',
      ].join('\n'),
    );
  });

  it('wraps long games at 80 characters and escapes quotes', () => {
    const moves = Array.from({ length: 60 }, (_, index) =>
      move(index + 1, 'a1', 'a2', index % 2 ? 'Nf6' : 'Nf3', ''),
    );
    const pgn = gamePgn(
      { ...game, whitePlayer: { ...game.whitePlayer, username: 'a"b' }, result: null },
      moves,
    );
    expect(pgn).toContain('[White "a\\"b"]');
    expect(pgn).toContain('[Termination "unterminated"]');
    const body = pgn.split('\n\n')[1].trim().split('\n');
    expect(body.length).toBeGreaterThan(1);
    expect(body.every((line) => line.length <= 80)).toBe(true);
    expect(body.at(-1)?.endsWith('*')).toBe(true);
  });

  it('names results as PGN does', () => {
    expect(pgnResult(null)).toBe('*');
    expect(pgnResult({ winner: null, reason: 'STALEMATE' })).toBe('1/2-1/2');
    expect(pgnResult({ winner: 'BLACK', reason: 'TIMEOUT' })).toBe('0-1');
    expect(pgnResult({ winner: null, reason: 'ABORTED' })).toBe('*');
    // Nobody lost an aborted game.
    expect(gamePgn({ ...game, result: { winner: null, reason: 'ABORTED' } }, [])).toContain(
      '[Termination "unterminated"]',
    );
  });
});

describe('Spoken moves', () => {
  it('reads a move in words for screen readers', () => {
    expect(spokenMove('e4', 'WHITE')).toBe('White: Pawn to e4');
    expect(spokenMove('exd5', 'WHITE')).toBe('White: e pawn takes d5');
    expect(spokenMove('Nf3+', 'BLACK')).toBe('Black: Knight to f3, check');
    expect(spokenMove('Rad1', 'WHITE')).toBe('White: Rook from a to d1');
    expect(spokenMove('O-O-O#', 'BLACK')).toBe('Black: castles queenside, checkmate');
    expect(spokenMove('e8=Q', 'WHITE')).toBe('White: Pawn to e8, promotes to queen');
  });
});
