/** FEN §16.1 of the PGN specification. Syntax only: legality belongs to the engine. */
export function assertFen(fen: string): void {
  const fields = fen.split(' ');
  if (
    fields.length !== 6 ||
    fields.some((field) => !field || !/^[\x21-\x7e]+$/.test(field))
  ) {
    throw new Error(
      'FEN must contain six fields separated by single ASCII spaces',
    );
  }
  const [placement, turn, castling, ep, halfmove, fullmove] = fields;
  const ranks = placement.split('/');
  if (
    ranks.length !== 8 ||
    ranks.some((rank) => {
      if (!/^[prnbqkPRNBQK1-8]+$/.test(rank) || /[1-8][1-8]/.test(rank))
        return true;
      return (
        rank
          .split('')
          .reduce(
            (width, token) => width + (/[1-8]/.test(token) ? Number(token) : 1),
            0,
          ) !== 8
      );
    })
  )
    throw new Error('FEN requires eight ranks of eight squares');
  if (!/^[wb]$/.test(turn)) throw new Error('Invalid FEN active color');
  if (!(castling === '-' || /^(?=.+)K?Q?k?q?$/.test(castling)))
    throw new Error('Invalid FEN castling availability');
  if (!(
    ep === '-' || new RegExp(`^[a-h]${turn === 'w' ? '6' : '3'}$`).test(ep)
  ))
    throw new Error('Invalid FEN en passant target');
  if (!/^\d+$/.test(halfmove) || !Number.isSafeInteger(Number(halfmove)))
    throw new Error('Invalid FEN halfmove clock');
  if (
    !/^\d+$/.test(fullmove) ||
    !Number.isSafeInteger(Number(fullmove)) ||
    Number(fullmove) < 1
  )
    throw new Error('Invalid FEN fullmove number');
}
