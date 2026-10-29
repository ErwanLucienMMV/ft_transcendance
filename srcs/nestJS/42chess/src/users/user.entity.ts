import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DEFAULT_PREFERENCES } from './user-preferences.js';
import type { UserPreferences } from './user-preferences.js';

import { INITIAL_ELO } from '../rating/rating.constants.js';

// Preserve the existing import path while keeping calculation code dependency-free.
export { INITIAL_ELO } from '../rating/rating.constants.js';

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

  @Column({ type: 'jsonb', default: DEFAULT_PREFERENCES })
  preferences: UserPreferences;

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

  // Null until the owner clicks the link sent by email. Accounts created
  // through OAuth are verified straight away.
  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  // SHA-256 of the pending verification token, never the token itself.
  @Column({
    type: 'varchar',
    length: 64,
    unique: true,
    nullable: true,
    select: false,
  })
  emailVerificationTokenHash: string | null;

  // An unverified account is deleted once this date has passed.
  @Column({ type: 'timestamptz', nullable: true })
  emailVerificationExpiresAt: Date | null;

  // Base32 TOTP secret shared with the authenticator app.
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  twoFactorSecret: string | null;

  // Null while two-factor authentication is off. Once set, a password login
  // only yields a challenge that must be completed with a TOTP code.
  @Column({ type: 'timestamptz', nullable: true })
  twoFactorEnabledAt: Date | null;

  // RFC 6238 time step of the last accepted code, so a code is single use.
  @Column({ type: 'integer', nullable: true })
  twoFactorLastTimeStep: number | null;

  // Wrong codes in a row; too many lock the code check for a while.
  @Column({ type: 'integer', default: 0 })
  twoFactorFailedAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  twoFactorLockedUntil: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
