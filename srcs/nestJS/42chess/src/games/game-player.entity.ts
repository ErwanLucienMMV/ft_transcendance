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
import type { Relation } from 'typeorm';
import { User } from '../users/user.entity.js';
import type { PlayerColor } from './clock/game-clock.js';
import { Game } from './game.entity.js';
import type { BotDifficulty } from '../bots/bot-engine.js';

@Entity('game_players')
@Check('CHK_game_players_color', `"color" IN ('WHITE', 'BLACK')`)
@Check(
	'CHK_game_players_kind',
	`("userId" IS NOT NULL AND "botDifficulty" IS NULL) OR ("userId" IS NULL AND "botDifficulty" IN ('EASY', 'MEDIUM', 'HARD') AND "botDifficulty" IS NOT NULL)`,
)
@Unique('UQ_game_players_color', ['gameId', 'color'])
@Unique('UQ_game_players_user', ['gameId', 'userId'])
@Index('IDX_game_players_userId', ['userId', 'gameId'])
export class GamePlayer {
	@PrimaryGeneratedColumn('uuid', {
		primaryKeyConstraintName: 'PK_game_players',
	})
	id: string;

	@Column({ type: 'uuid' })
	gameId: string;

	@Column({ type: 'uuid', nullable: true })
	userId: string | null;

	@Column({ type: 'varchar', length: 6, nullable: true })
	botDifficulty: BotDifficulty | null;

	@Column({ type: 'varchar', length: 5 })
	color: PlayerColor;

	@CreateDateColumn({ type: 'timestamptz' })
	joinedAt: Date;

	@ManyToOne(() => Game, { nullable: false, onDelete: 'CASCADE' })
	@JoinColumn({
		name: 'gameId',
		foreignKeyConstraintName: 'FK_game_players_game',
	})
	game: Relation<Game>;

	// Preserve game history; user deletion/anonymization needs its own policy.
	@ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
	@JoinColumn({
		name: 'userId',
		foreignKeyConstraintName: 'FK_game_players_user',
	})
	user: Relation<User>;
}
