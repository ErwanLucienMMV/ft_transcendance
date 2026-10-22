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

/** DB-13; constraints and indexes are owned by migrations. */
@Check('CHK_friendships_0', `"userId" < "friendId"`)
@Unique('UQ_friendships_1', ['userId', 'friendId'])
@Entity('friendships')
export class Friendship {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'uuid' })
  friendId: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_friendships_userId',
  })
  user: User;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'friendId',
    foreignKeyConstraintName: 'FK_friendships_friendId',
  })
  friend: User;
}
