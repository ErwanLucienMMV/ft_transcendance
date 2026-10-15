import {
  Entity,
  Check,
  Unique,
  Index,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

/** DB-17 DB-18; constraints and indexes are owned by migrations. */
@Unique('UQ_matchmaking_queue_0', ['userId'])
@Check(
  'CHK_matchmaking_queue_1',
  `"rating" >= 0 AND "initialTime" > 0 AND "increment" >= 0`,
)
@Index('IDX_matchmaking_lookup', [
  'initialTime',
  'increment',
  'rating',
  'createdAt',
  'id',
])
@Entity('matchmaking_queue')
export class MatchmakingEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'integer' })
  rating: number;
  @Column({ type: 'integer' })
  initialTime: number;
  @Column({ type: 'integer', default: 0 })
  increment: number;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_matchmaking_queue_userId',
  })
  user: User;
}
