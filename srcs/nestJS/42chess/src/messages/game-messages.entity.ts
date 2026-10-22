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
import { Game } from '../games/game.entity.js';
import { User } from '../users/user.entity.js';

/** DB-15; constraints and indexes are owned by migrations. */
@Check('CHK_game_messages_0', `length(btrim("content")) > 0`)
@Index('IDX_game_messages_history', ['gameId', 'createdAt', 'id'])
@Entity('game_messages')
export class GameMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  gameId: string;
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'varchar', length: 2000 })
  content: string;
  @ManyToOne(() => Game, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'gameId',
    foreignKeyConstraintName: 'FK_game_messages_gameId',
  })
  game: Game;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_game_messages_userId',
  })
  user: User;
}
