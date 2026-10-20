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
import { User } from '../users/user.entity.js';

/** DB-05 DB-06; constraints and indexes are owned by migrations. */
@Unique('UQ_oauth_accounts_0', ['provider', 'providerUserId'])
@Check(
  'CHK_oauth_accounts_1',
  `length(btrim("provider")) > 0 AND length(btrim("providerUserId")) > 0`,
)
@Entity('oauth_accounts')
export class OauthAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'varchar', length: 32 })
  provider: string;
  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_oauth_accounts_userId',
  })
  user: User;
}
