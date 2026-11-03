import {
  applyMove,
  isInCheck,
  legalMoves,
  material,
  parseFen,
  Position,
  positionStatus,
  premoveTargets,
  sanOf,
  squareIndex,
  squareName,
  toFen,
} from './chess-rules';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(position);
  if (depth === 1) return moves.length;
  return moves.reduce((total, move) => total + perft(applyMove(position, move), depth - 1), 0);
}

function targets(fen: string, from: string): string[] {
  return legalMoves(parseFen(fen))
    .filter((move) => move.from === from)
    .map((move) => move.to + (move.promotion ?? ''))
    .sort();
}

describe('Display chess rules', () => {
  it('maps square names in FEN order', () => {
    expect(squareIndex('a8')).toBe(0);
    expect(squareIndex('h1')).toBe(63);
    expect(squareName(squareIndex('e4'))).toBe('e4');
    expect(() => squareIndex('i9')).toThrow();
  });

  it('reads every FEN field and rejects positions the board cannot draw', () => {
    const position = parseFen('4k3/8/8/3pP3/8/8/8/4K2R w K d6 3 40');
    expect(position.board[squareIndex('e5')]).toEqual({ color: 'w', type: 'p' });
    expect(position).toMatchObject({ turn: 'w', castling: 'K', halfmove: 3, fullmove: 40 });
    expect(position.enPassant).toBe(squareIndex('d6'));
    for (const fen of [
      '',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1',
      'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQXBNR w KQkq - 0 1',
      'rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 0',
    ]) {
      expect(() => parseFen(fen), fen).toThrow();
    }
  });

  // Reference node counts from https://www.chessprogramming.org/Perft_Results
  it.each([
    [START, 3, 8902],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 2, 1486],
  ])('generates the reference perft count for %s', (fen, depth, nodes) => {
    expect(perft(parseFen(fen), depth)).toBe(nodes);
  });

  it('offers castling only through empty, unattacked squares', () => {
    expect(targets('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1')).toContain('g1');
    expect(targets('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1')).toContain('c1');
    expect(targets('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1', 'e1')).not.toContain('g1');
    expect(targets('4k3/8/8/8/8/8/8/R3K1NR w KQ - 0 1', 'e1')).not.toContain('g1');
    expect(targets('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('g1');
    const castled = applyMove(parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), {
      from: 'e1',
      to: 'g1',
    });
    expect(castled.board[squareIndex('f1')]).toEqual({ color: 'w', type: 'r' });
    expect(castled.castling).toBe('kq');
  });

  it('captures en passant and removes the passed pawn', () => {
    expect(targets('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5')).toEqual(['d6', 'e6']);
    const after = applyMove(parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), {
      from: 'e5',
      to: 'd6',
    });
    expect(after.board[squareIndex('d5')]).toBeNull();
  });

  it('offers every promotion piece', () => {
    expect(targets('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7')).toEqual(['a8b', 'a8n', 'a8q', 'a8r']);
  });

  it('detects check, checkmate and stalemate', () => {
    const mate = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(isInCheck(mate)).toBe(true);
    expect(positionStatus(mate)).toBe('checkmate');
    expect(positionStatus(parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('stalemate');
    expect(positionStatus(parseFen(START))).toBe('ongoing');
    expect(isInCheck(parseFen('4k3/8/8/8/8/8/8/4K2r w - - 0 1'))).toBe(true);
  });

  it('keeps pinned pieces on the pin line', () => {
    expect(targets('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1', 'e2')).toEqual([]);
  });

  it('writes a played position back to FEN', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    expect(toFen(parseFen(fen))).toBe(fen);
    expect(toFen(applyMove(parseFen(START), { from: 'e2', to: 'e4' }))).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
  });
});

describe('Notation, premoves and material', () => {
  const position = (fen: string) => parseFen(fen);

  it('writes standard algebraic notation', () => {
    const start = position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(sanOf(start, { from: 'g1', to: 'f3' })).toBe('Nf3');
    expect(sanOf(start, { from: 'e2', to: 'e4' })).toBe('e4');
    const knights = position('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');
    expect(sanOf(knights, { from: 'b1', to: 'd2' })).toBe('Nbd2');
    const rooks = position('4k3/8/R7/8/R7/8/8/4K3 w - - 0 1');
    expect(sanOf(rooks, { from: 'a6', to: 'a5' })).toBe('R6a5');
    const capture = position('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    expect(sanOf(capture, { from: 'e4', to: 'd5' })).toBe('exd5');
    const castle = position('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(sanOf(castle, { from: 'e1', to: 'g1' })).toBe('O-O');
    expect(sanOf(castle, { from: 'e1', to: 'c1' })).toBe('O-O-O');
    const promote = position('7k/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(sanOf(promote, { from: 'e7', to: 'e8', promotion: 'q' })).toBe('e8=Q+');
    const mate = position('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(sanOf(mate, { from: 'a1', to: 'a8' })).toBe('Ra8#');
    const passant = position('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(sanOf(passant, { from: 'e5', to: 'd6' })).toBe('exd6');
  });

  it('offers premoves by the shape of the piece, whatever stands in the way', () => {
    const start = position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
    expect(premoveTargets(start, 'e2').sort()).toEqual(['d3', 'e3', 'e4', 'f3']);
    expect(premoveTargets(start, 'a1').length).toBe(14);
    expect(premoveTargets(start, 'e1').sort()).toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1']);
    expect(premoveTargets(start, 'e5')).toEqual([]);
  });

  it('counts captured pieces and the material balance', () => {
    const start = position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(material(start)).toEqual({ captured: { w: [], b: [] }, balance: 0 });
    // White took a knight and a pawn, Black took a bishop.
    const middle = position('r1bqkbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RN1QKBNR w KQkq - 0 1');
    expect(material(middle)).toEqual({ captured: { w: ['n', 'p'], b: ['b'] }, balance: 1 });
  });
});
