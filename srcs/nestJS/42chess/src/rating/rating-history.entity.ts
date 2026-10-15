import {
  Entity,
  Check,
  Unique,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Game } from '../games/game.entity.js';
import { User } from '../users/user.entity.js';

/** DB-16; constraints and indexes are owned by migrations. */
@Unique('UQ_rating_history_0', ['userId', 'gameId'])
@Check('CHK_rating_history_1', `"ratingBefore" >= 0 AND "ratingAfter" >= 0`)
@Entity('rating_history')
export class RatingHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'uuid' })
  gameId: string;
  @Column({ type: 'integer' })
  ratingBefore: number;
  @Column({ type: 'integer' })
  ratingAfter: number;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_rating_history_userId',
  })
  user: User;
  @ManyToOne(() => Game, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'gameId',
    foreignKeyConstraintName: 'FK_rating_history_gameId',
  })
  game: Game;
}
