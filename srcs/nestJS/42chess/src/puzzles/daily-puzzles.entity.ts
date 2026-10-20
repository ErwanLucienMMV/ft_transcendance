import {
  Entity,
  Unique,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Puzzle } from '../puzzles/puzzles.entity.js';

/** DB-20; constraints and indexes are owned by migrations. */
@Unique('UQ_daily_puzzles_0', ['date'])
@Entity('daily_puzzles')
export class DailyPuzzle {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  puzzleId: string;
  @Column({ type: 'date' })
  date: string;
  @ManyToOne(() => Puzzle, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'puzzleId',
    foreignKeyConstraintName: 'FK_daily_puzzles_puzzleId',
  })
  puzzle: Puzzle;
}
