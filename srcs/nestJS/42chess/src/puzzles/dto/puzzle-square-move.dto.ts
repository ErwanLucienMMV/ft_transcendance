import { IsIn, IsOptional, Matches } from 'class-validator';

export const PUZZLE_PROMOTIONS = {
  QUEEN: 'q',
  ROOK: 'r',
  BISHOP: 'b',
  KNIGHT: 'n',
} as const;

/** Spec §30 move body `{ from, to }`, with the optional promotion of spec §12. */
export class PuzzleSquareMoveDto {
  @Matches(/^[a-h][1-8]$/)
  from: string;

  @Matches(/^[a-h][1-8]$/)
  to: string;

  @IsOptional()
  @IsIn(Object.keys(PUZZLE_PROMOTIONS))
  promotion?: keyof typeof PUZZLE_PROMOTIONS | null;
}
