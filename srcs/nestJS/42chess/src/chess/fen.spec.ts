import { assertFen } from './fen.js';

describe('six-field FEN syntax (PGN §16.1)', () => {
  const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it.each([
    initial,
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
    '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    '8/8/8/8/8/6k1/5q2/7K b - - 0 1',
  ])(
    'accepts complete FEN including en passant without an available capture: %s',
    (fen) => {
      expect(() => assertFen(fen)).not.toThrow();
    },
  );
  it.each([
    '8/8/8/8/8/8/8/8 w - -', // four-field positions are EPD, not full FEN
    initial + ' extra',
    initial.replace(' w ', '  w '),
    initial + '\n',
    initial.replace(' w ', ' W '),
    initial.replace('KQkq', 'KK'),
    initial.replace('KQkq', 'qK'),
    initial.replace(' - ', ' e3 '),
    initial.replace(' - ', ' z6 '),
    initial.replace(' 0 1', ' -1 1'),
    initial.replace(' 0 1', ' 0 0'),
    initial.replace(' 0 1', ' 0 1.5'),
    '8/8/8/8/8/8/8 w - - 0 1',
    '9/8/8/8/8/8/8/8 w - - 0 1',
    '7/8/8/8/8/8/8/8 w - - 0 1',
    '44/8/8/8/8/8/8/8 w - - 0 1',
  ])('rejects malformed FEN: %s', (fen) =>
    expect(() => assertFen(fen)).toThrow(),
  );
  it('does not claim that syntactically correct positions are legal chess', () => {
    expect(() => assertFen('8/8/8/8/8/8/8/8 w - - 0 1')).not.toThrow();
  });
});
