import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const INITIAL_ELO = 1200;

/**
 * Internal account shared by every authentification method (local password,
 * Google, Github). Oauth identities will reference this entity; the rest of
 * the application only deal with 'User'.
 */
// Case-insensitive uniqueness ("Alice" vs "alice"), created by the
// UsernameCaseInsensitiveUnique migration: TypeORM cannot describe an
// expression index, so it must not try to synchronize it.
@Index('UQ_users_username_lower', { synchronize: false })
// Registration lowercases emails; this makes the database enforce it for
// every other path too (OAuth, scripts), so uniqueness cannot be bypassed.
@Check('CHK_users_email_lowercase', `"email" = LOWER("email")`)
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 254, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'integer', default: INITIAL_ELO })
  elo: number;

  @Column({ type: 'integer', default: 0 })
  gamesPlayed: number;

  @Column({ type: 'integer', default: 0 })
  gamesWon: number;

  @Column({ type: 'integer', default: 0 })
  gamesDraw: number;

  @Column({ type: 'integer', default: 0 })
  gamesLost: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
