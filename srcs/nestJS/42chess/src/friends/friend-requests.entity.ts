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
import { User } from '../users/user.entity.js';

/** DB-12; constraints and indexes are owned by migrations. */
@Check('CHK_friend_requests_0', `"senderId" <> "recipientId"`)
@Check(
  'CHK_friend_requests_1',
  `"status" IN ('PENDING', 'ACCEPTED', 'REJECTED')`,
)
@Index('UQ_friend_requests_pending_pair', { synchronize: false })
@Entity('friend_requests')
export class FriendRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  senderId: string;
  @Column({ type: 'uuid' })
  recipientId: string;
  @Column({ type: 'varchar', length: 8, default: 'PENDING' })
  status: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'senderId',
    foreignKeyConstraintName: 'FK_friend_requests_senderId',
  })
  sender: User;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_friend_requests_recipientId',
  })
  recipient: User;
}
