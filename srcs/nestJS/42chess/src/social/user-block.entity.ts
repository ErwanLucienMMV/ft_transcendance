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
import { User } from '../users/user.entity.js';

/** One player hiding another: no message, friend request or challenge between them. */
@Check('CHK_user_blocks_self', `"blockerId" <> "blockedId"`)
@Unique('UQ_user_blocks_pair', ['blockerId', 'blockedId'])
@Index('IDX_user_blocks_blockedId', ['blockedId'])
@Entity('user_blocks')
export class UserBlock {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_user_blocks',
  })
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  blockerId: string;
  @Column({ type: 'uuid' })
  blockedId: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blockerId',
    foreignKeyConstraintName: 'FK_user_blocks_blockerId',
  })
  blocker: User;
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blockedId',
    foreignKeyConstraintName: 'FK_user_blocks_blockedId',
  })
  blocked: User;
}
