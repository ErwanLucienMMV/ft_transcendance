import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { Relation } from 'typeorm';
import type { PlayerColor } from './clock/game-clock.js';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';

@Entity('moves')
@Unique('UQ_moves_ply', ['gameId', 'ply'])
@Check('CHK_moves_ply', `"ply" > 0`)
@Check(
  'CHK_moves_uci',
  `"uci" ~ '^[a-h][1-8][a-h][1-8][qrbn]?$' AND left("uci", 2) <> substring("uci", 3, 2)`,
)
@Check('CHK_moves_position', `length(btrim("fenAfter")) > 0`)
export class Move {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_moves' })
  id: string;

  @Column({ type: 'uuid' })
  gameId: string;

  @Column({ type: 'varchar', length: 5 })
  color: PlayerColor;

  // One-based half-move number, ordered from the game's initialFen.
  @Column({ type: 'integer' })
  ply: number;

  @Column({ type: 'varchar', length: 5 })
  uci: string;

  @Column({ type: 'text' })
  fenAfter: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Game, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId', foreignKeyConstraintName: 'FK_moves_game' })
  game: Relation<Game>;

  // The author must occupy this color in this game, not merely any game.
  @ManyToOne(() => GamePlayer, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn([
    {
      name: 'gameId',
      referencedColumnName: 'gameId',
      foreignKeyConstraintName: 'FK_moves_player',
    },
    {
      name: 'color',
      referencedColumnName: 'color',
      foreignKeyConstraintName: 'FK_moves_player',
    },
  ])
  player: Relation<GamePlayer>;
}
