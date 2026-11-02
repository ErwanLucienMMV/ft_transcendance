import type { GameMove, GamePlayer } from '../../core/realtime/game-realtime';
import { moveRows, playerLabel, resultText, seatOf } from './game-text';

const player = (id: string, color: 'WHITE' | 'BLACK', elo: number | null = 1200): GamePlayer => ({
  id,
  username: id,
  avatarUrl: null,
  elo,
  color,
});
const move = (number: number, notation: string | null): GameMove => ({
  number,
  playerId: 'p',
  from: 'e2',
  to: 'e4',
  notation,
  fen: '',
  timestamp: '',
});

describe('Shared game wording', () => {
  it('words a result for anyone, or for the player who sees it', () => {
    expect(resultText({ winner: 'WHITE', reason: 'CHECKMATE' })).toBe('White wins by checkmate');
    expect(resultText({ winner: null, reason: 'DRAW_AGREEMENT' })).toBe('Draw by agreement');
    expect(resultText({ winner: 'BLACK', reason: 'TIMEOUT' }, 'BLACK')).toBe('You won on time');
    expect(resultText({ winner: 'BLACK', reason: null }, 'WHITE')).toBe('You lost');
    expect(resultText({ winner: 'WHITE', reason: 'SOMETHING_NEW' })).toBe('White wins');
  });

  it('names players and bots, and finds the seat of a user', () => {
    expect(playerLabel(player('rival', 'BLACK', 1216))).toBe('rival (1216)');
    expect(playerLabel({ ...player('seat', 'BLACK', null), botDifficulty: 'HARD' })).toBe(
      'Computer · Hard',
    );
    expect(playerLabel(null)).toBe('Unknown player');
    const game = { whitePlayer: player('a', 'WHITE'), blackPlayer: player('b', 'BLACK') };
    expect(seatOf(game, 'a')).toBe('WHITE');
    expect(seatOf(game, 'b')).toBe('BLACK');
    expect(seatOf(game, 'c')).toBeNull();
    expect(seatOf(game, null)).toBeNull();
  });

  it('pairs plies into numbered rows, even when Black moved first', () => {
    expect(moveRows([move(1, 'e4'), move(2, 'e5'), move(3, null)])).toEqual([
      { number: 1, white: { text: 'e4', ply: 1 }, black: { text: 'e5', ply: 2 } },
      { number: 2, white: { text: 'e2-e4', ply: 3 }, black: null },
    ]);
    expect(moveRows([move(2, 'e5')])).toEqual([
      { number: 1, white: null, black: { text: 'e5', ply: 2 } },
    ]);
  });
});
