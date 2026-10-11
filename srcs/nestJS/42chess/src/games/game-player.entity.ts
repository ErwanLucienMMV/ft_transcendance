import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../users/user.entity.js';
import type { PlayerColor } from './clock/game-clock.js';
import { Game } from './game.entity.js';

@Entity('game_players')
@Check('CHK_game_players_color', `"color" IN ('WHITE', 'BLACK')`)
@Unique('UQ_game_players_color', ['gameId', 'color'])
@Unique('UQ_game_players_user', ['gameId', 'userId'])
@Index('IDX_game_players_userId', ['userId', 'gameId'])
export class GamePlayer {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_game_players',
  })
  id: string;

  @Column({ type: 'uuid' })
  gameId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 5 })
  color: PlayerColor;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;

  @ManyToOne(() => Game, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gameId',
    foreignKeyConstraintName: 'FK_game_players_game',
  })
  game: Relation<Game>;

  // Preserve game history; user deletion/anonymization needs its own policy.
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_game_players_user',
  })
  user: Relation<User>;
}
