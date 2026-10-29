import {
  Column,
  Entity,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity.js';

@Entity('auth_sessions')
@Index(['userId'])
export class AuthSession {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') userId: string;
  @Column('timestamptz') expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  /** SHA-256 of the refresh cookie secret; the secret itself is never stored. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  refreshTokenHash: string | null;
  /** The secret replaced by the last rotation, accepted briefly for concurrent tabs. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  previousRefreshTokenHash: string | null;
  @Column({ type: 'timestamptz', nullable: true })
  refreshRotatedAt: Date | null;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
