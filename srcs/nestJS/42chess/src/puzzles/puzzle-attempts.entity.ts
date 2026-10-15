import {
  Entity,
  Check,
  Index,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Puzzle } from '../puzzles/puzzles.entity.js';
import { User } from '../users/user.entity.js';

/** DB-21; constraints and indexes are owned by migrations. */
@Check('CHK_puzzle_attempts_0', `array_position("moves", NULL) IS NULL`)
@Index('IDX_puzzle_attempts_user', ['userId', 'puzzleId', 'createdAt'])
@Check('CHK_puzzle_attempts_metrics', `"attempts" >= 0 AND "duration" >= 0`)
@Entity('puzzle_attempts')
export class PuzzleAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'uuid' })
  puzzleId: string;
  @Column({ type: 'boolean', default: false })
  solved: boolean;
  @Column({ type: 'text', array: true, default: [] })
  moves: string[];
  @Column({ type: 'integer', nullable: true })
  attempts: number | null;
  /** Elapsed solving time in milliseconds; NULL for unknown legacy measurements. */
  @Column({ type: 'integer', nullable: true })
  duration: number | null;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_puzzle_attempts_userId',
  })
  user: User;
  @ManyToOne(() => Puzzle, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'puzzleId',
    foreignKeyConstraintName: 'FK_puzzle_attempts_puzzleId',
  })
  puzzle: Puzzle;
}
