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

/** DB-14; constraints and indexes are owned by migrations. */
@Check('CHK_messages_0', `"senderId" <> "recipientId"`)
@Check('CHK_messages_1', `length(btrim("content")) > 0`)
@Index('IDX_messages_conversation', [
  'senderId',
  'recipientId',
  'createdAt',
  'id',
])
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  senderId: string;
  @Column({ type: 'uuid' })
  recipientId: string;
  @Column({ type: 'varchar', length: 2000 })
  content: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'senderId',
    foreignKeyConstraintName: 'FK_messages_senderId',
  })
  sender: User;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_messages_recipientId',
  })
  recipient: User;
}
