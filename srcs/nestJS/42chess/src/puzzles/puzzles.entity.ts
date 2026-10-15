import {
  Entity,
  Check,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import type { ChessMove } from '../common/types/chess.js';
import type { SerializedPuzzleMove, PuzzleTheme } from './puzzle.types.js';

/** DB-19; constraints and indexes are owned by migrations. */
@Check('CHK_puzzles_0', `length(btrim("fen")) > 0`)
@Check(
  'CHK_puzzles_1',
  `cardinality("solution") > 0 AND array_position("solution", NULL) IS NULL`,
)
@Check('CHK_puzzles_2', `"rating" >= 0`)
@Check(
  'CHK_puzzles_themes',
  `"themes" <@ ARRAY['CHECK','CHECKMATE','FORK','PIN','SKEWER','DISCOVERED_ATTACK','MATE_IN_ONE','MATE_IN_TWO']::text[] AND array_position("themes", NULL) IS NULL`,
)
@Check(
  'CHK_puzzles_solution_moves',
  `"solutionMoves" IS NULL OR (jsonb_typeof("solutionMoves") = 'array' AND jsonb_array_length("solutionMoves") > 0)`,
)
@Entity('puzzles')
export class Puzzle {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'text' })
  fen: string;
  // UCI storage remains available to the existing engine integration. Never a public DTO.
  @Column({ type: 'text', array: true, select: false })
  solution: string[];
  @Column({ type: 'integer', default: 1200 })
  rating: number;
  @Column({ type: 'text', array: true, nullable: true })
  themes: PuzzleTheme[] | null;
  // NULL means pre-contract metadata is unknown; migrations never fabricate it.
  @Column({
    type: 'jsonb',
    nullable: true,
    select: false,
    transformer: {
      to: (moves: ChessMove[] | null) =>
        moves?.map((move) => ({
          ...move,
          timestamp: move.timestamp.toISOString(),
        })) ?? null,
      from: (moves: SerializedPuzzleMove[] | null) =>
        moves?.map((move) => ({
          ...move,
          timestamp: new Date(move.timestamp),
        })) ?? null,
    },
  })
  solutionMoves: ChessMove[] | null;
}
