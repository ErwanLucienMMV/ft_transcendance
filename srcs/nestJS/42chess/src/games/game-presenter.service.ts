import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { User } from '../users/user.entity.js';
import { GameError } from './game-error.js';
import type { GameState } from './game-state.js';
import type {
	GameMovesResponse,
	GameResponse,
	PlayerRef,
	PromotionPiece,
} from './game-api.types.js';

@Injectable()
export class GamePresenterService {
	constructor(private readonly source: DataSource) {}

	async state({ game, players }: GameState): Promise<GameResponse> {
		const users = await this.source.getRepository(User).find({
			where: {
				id: In(
					players.flatMap((player) => (player.userId ? [player.userId] : [])),
				),
			},
			select: { id: true, username: true, avatarUrl: true, elo: true },
		});
		const refs: PlayerRef[] = players.map((player) => {
			if (player.botDifficulty && player.userId === null)
				return {
					id: player.id,
					username: `Bot ${player.botDifficulty}`,
					avatarUrl: null,
					elo: null,
					color: player.color,
					botDifficulty: player.botDifficulty,
				};
			const user = users.find((user) => user.id === player.userId);
			if (!user)
				throw new GameError(
					'INVALID_GAME_HISTORY',
					'A seated player account is missing.',
				);
			return {
				id: user.id,
				username: user.username,
				avatarUrl: user.avatarUrl,
				elo: user.elo,
				color: player.color,
			} satisfies PlayerRef;
		});
		const parts = game.currentFen.split(' ');
		const halfmoveClock = Number(parts[4]),
			fullmoveNumber = Number(parts[5]);
		if (
			!Number.isSafeInteger(halfmoveClock) ||
			!Number.isSafeInteger(fullmoveNumber)
		)
			throw new GameError(
				'INVALID_GAME_HISTORY',
				'The stored board counters are invalid.',
			);
		return {
			id: game.id,
			status: game.status,
			whitePlayer: refs.find((player) => player.color === 'WHITE') ?? null,
			blackPlayer: refs.find((player) => player.color === 'BLACK') ?? null,
			timeControl: { initialTime: game.initialTime, increment: game.increment },
			board: {
				fen: game.currentFen,
				turn: game.turn,
				halfmoveClock,
				fullmoveNumber,
			},
			clocks: game.clock
				? { white: game.clock.white, black: game.clock.black }
				: null,
			result: game.result
				? {
						winner:
							game.result === 'WHITE_WIN'
								? 'WHITE'
								: game.result === 'BLACK_WIN'
									? 'BLACK'
									: null,
						reason: game.endReason,
					}
				: null,
			drawOffer: game.drawOffer
				? {
						playerId: refs.find((player) => player.color === game.drawOffer)!
							.id,
					}
				: null,
			startedAt: game.startedAt?.toISOString() ?? null,
			endedAt: game.finishedAt?.toISOString() ?? null,
			createdAt: game.createdAt.toISOString(),
		};
	}

	moves({ players, moves }: GameState): GameMovesResponse {
		const promotions: Record<string, PromotionPiece> = {
			q: 'QUEEN',
			r: 'ROOK',
			b: 'BISHOP',
			n: 'KNIGHT',
		};
		return {
			moves: moves.map((move) => {
				const player = players.find((player) => player.color === move.color);
				if (!player)
					throw new GameError(
						'INVALID_GAME_HISTORY',
						'A stored move has no seated player.',
					);
				return {
					number: move.ply,
					playerId: player.userId ?? player.id,
					from: move.uci.slice(0, 2),
					to: move.uci.slice(2, 4),
					...(move.uci.length === 5
						? { promotion: promotions[move.uci[4]] }
						: {}),
					notation: move.notation,
					fen: move.fenAfter,
					timestamp: move.createdAt.toISOString(),
				};
			}),
		};
	}
}
