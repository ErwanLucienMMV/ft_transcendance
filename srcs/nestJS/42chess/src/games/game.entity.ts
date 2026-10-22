import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../users/user.entity.js';
import type { UUID } from '../common/types/api.js';
import type { PlayerColor } from './clock/game-clock.js';
import type { PersistentClock } from './clock/game-clocks.service.js';

export type GameStatus = 'WAITING' | 'ACTIVE' | 'FINISHED';
export type GameResult = 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW';
export type GameEndReason =
  | 'CHECKMATE'
  | 'RESIGNATION'
  | 'TIMEOUT'
  | 'DRAW_AGREEMENT'
  | 'STALEMATE'
  | 'INSUFFICIENT_MATERIAL'
  | 'THREEFOLD_REPETITION'
  | 'FIFTY_MOVE_RULE';
export const INITIAL_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

@Entity('games')
@Index('IDX_games_status_createdAt', ['status', 'createdAt', 'id'])
@Index('IDX_games_createdAt', ['createdAt', 'id'])
@Index('IDX_games_invited_opponent', ['invitedOpponentId'])
@Index('IDX_games_clock_deadline', ['clockDeadline', 'id'], {
  where: `"status" = 'ACTIVE'`,
})
@Check('CHK_games_status', `"status" IN ('WAITING', 'ACTIVE', 'FINISHED')`)
@Check('CHK_games_turn', `"turn" IN ('WHITE', 'BLACK')`)
@Check('CHK_games_time_control', `"initialTime" > 0 AND "increment" >= 0`)
@Check(
  'CHK_games_position',
  `length(btrim("initialFen")) > 0 AND length(btrim("currentFen")) > 0`,
)
@Check('CHK_games_result', `"result" IN ('WHITE_WIN', 'BLACK_WIN', 'DRAW')`)
@Check(
  'CHK_games_lifecycle',
  `("status" = 'WAITING' AND "startedAt" IS NULL AND "finishedAt" IS NULL AND "result" IS NULL)
   OR ("status" = 'ACTIVE' AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL AND "result" IS NULL)
   OR ("status" = 'FINISHED' AND "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "result" IS NOT NULL)`,
)
@Check('CHK_games_finish_time', `"finishedAt" >= "startedAt"`)
@Check('CHK_games_clock', `clock IS NULL OR jsonb_typeof(clock) = 'object'`)
@Check(
  'CHK_games_clock_deadline',
  `"clockDeadline" IS NULL OR status = 'ACTIVE'`,
)
@Check(
  'CHK_games_draw_offer',
  `"drawOffer" IS NULL OR ("status" = 'ACTIVE' AND "drawOffer" IN ('WHITE', 'BLACK'))`,
)
@Check(
  'CHK_games_end_reason',
  `"endReason" IS NULL OR ("status" = 'FINISHED' AND "endReason" IN ('CHECKMATE', 'RESIGNATION', 'TIMEOUT', 'DRAW_AGREEMENT', 'STALEMATE', 'INSUFFICIENT_MATERIAL', 'THREEFOLD_REPETITION', 'FIFTY_MOVE_RULE'))`,
)
@Check(
  'CHK_games_bot_lease',
  `("botLeaseToken" IS NULL AND "botLeaseUntil" IS NULL) OR ("botLeaseToken" IS NOT NULL AND "botLeaseUntil" IS NOT NULL AND status = 'ACTIVE')`,
)
export class Game {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_games' })
  id: UUID;

  @Column({ type: 'uuid', nullable: true })
  invitedOpponentId: UUID | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'invitedOpponentId',
    foreignKeyConstraintName: 'FK_games_invited_opponent',
  })
  invitedOpponent: Relation<User>;

  @Column({ type: 'varchar', length: 8, default: 'WAITING' })
  status: GameStatus;

  // Replay uses this position plus ordered UCI moves, not currentFen plus moves.
  @Column({ type: 'text', default: INITIAL_FEN })
  initialFen: string;

  @Column({ type: 'text', default: INITIAL_FEN })
  currentFen: string;

  @Column({ type: 'varchar', length: 5, default: 'WHITE' })
  turn: PlayerColor;

  // Time controls use integer milliseconds, matching GameClock.
  @Column({ type: 'integer' })
  initialTime: number;

  @Column({ type: 'integer', default: 0 })
  increment: number;

  @Column({ type: 'varchar', length: 9, nullable: true })
  result: GameResult | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  drawOffer: PlayerColor | null;

  // Existing finished games have no recorded reason; never invent one on migration.
  @Column({ type: 'varchar', length: 24, nullable: true })
  endReason: GameEndReason | null;

  @Column({ type: 'jsonb', nullable: true })
  clock: PersistentClock | null;

  @Column({ type: 'timestamptz', nullable: true })
  clockDeadline: Date | null;

  // A short transaction claims work; no connection is held during search.
  @Column({ type: 'uuid', nullable: true })
  botLeaseToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  botLeaseUntil: Date | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  botError: 'BOT_UNAVAILABLE' | 'INVALID_BOT_RESPONSE' | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
