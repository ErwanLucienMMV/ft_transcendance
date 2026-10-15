import {
  Entity,
  Check,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/** DB-19; constraints and indexes are owned by migrations. */
@Check('CHK_puzzles_0', `length(btrim("fen")) > 0`)
@Check(
  'CHK_puzzles_1',
  `cardinality("solution") > 0 AND array_position("solution", NULL) IS NULL`,
)
@Check('CHK_puzzles_2', `"rating" >= 0`)
@Entity('puzzles')
export class Puzzle {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'text' })
  fen: string;
  @Column({ type: 'text', array: true })
  solution: string[];
  @Column({ type: 'integer', default: 1200 })
  rating: number;
}
