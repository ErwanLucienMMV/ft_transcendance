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
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
