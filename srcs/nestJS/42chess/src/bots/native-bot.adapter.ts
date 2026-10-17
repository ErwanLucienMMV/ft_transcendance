import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BotEngine, BOT_DIFFICULTIES } from './bot-engine.js';
import type { BotDifficulty, BotMove } from './bot-engine.js';
import type { ChessPosition } from '../chess/chess-engine.service.js';
import { GameError } from '../games/game-error.js';
import { isFen } from '../games/game-input.js';

@Injectable()
export class NativeBotAdapter extends BotEngine {
	bestMove(
		position: ChessPosition,
		difficulty: BotDifficulty,
	): Promise<BotMove> {
		if (!BOT_DIFFICULTIES.includes(difficulty)) {
			return Promise.reject(
				new GameError('INVALID_GAME_INPUT', 'Unsupported bot difficulty.'),
			);
		}
		return new Promise((resolve, reject) => {
			const id = randomUUID();
			let socket: WebSocket;
			try {
				socket = new WebSocket(
					process.env.BOT_ENGINE_URL ?? 'ws://127.0.0.1:8082',
				);
			} catch {
				reject(new GameError('BOT_UNAVAILABLE', 'Invalid bot endpoint.'));
				return;
			}
			let settled = false;
			const finish = (error?: GameError, result?: BotMove) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (
					socket.readyState === WebSocket.OPEN ||
					socket.readyState === WebSocket.CONNECTING
				)
					socket.close();
				if (error) reject(error);
				else resolve(result!);
			};
			// At most two jobs ahead of this request with the daemon's bounded queue.
			const timer = setTimeout(
				() =>
					finish(new GameError('BOT_UNAVAILABLE', 'Bot request timed out.')),
				10_000,
			);
			socket.addEventListener('open', () => {
				try {
					socket.send(
						JSON.stringify({ ...position, id, op: 'best_move', difficulty }),
					);
				} catch {
					finish(
						new GameError('BOT_UNAVAILABLE', 'Could not send bot request.'),
					);
				}
			});
			socket.addEventListener('message', (event) => {
				try {
					if (typeof event.data !== 'string') throw new Error('Expected text');
					const response = JSON.parse(event.data) as Record<string, unknown>;
					if (response.id !== id || typeof response.ok !== 'boolean')
						throw new Error('Invalid envelope');
					if (!response.ok) {
						finish(
							new GameError(
								'BOT_UNAVAILABLE',
								'The bot rejected the position.',
							),
						);
						return;
					}
					const result = response.result as BotMove | undefined;
					if (
						!result ||
						result.difficulty !== difficulty ||
						!isFen(result.fen) ||
						![
							'ongoing',
							'checkmate',
							'stalemate',
							'insufficient_material',
						].includes(result.status) ||
						![
							result.scoreCp,
							result.depth,
							result.nodes,
							result.elapsedMs,
						].every(Number.isSafeInteger) ||
						result.depth < 0 ||
						result.depth > 5 ||
						result.nodes < 0 ||
						result.elapsedMs < 0 ||
						(result.bestMove !== null &&
							(typeof result.bestMove !== 'string' ||
								!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(result.bestMove))) ||
						(result.bestMove === null
							? result.fenAfter !== null || result.status === 'ongoing'
							: !isFen(result.fenAfter) || result.status !== 'ongoing')
					) {
						throw new Error('Invalid search result');
					}
					finish(undefined, result);
				} catch {
					finish(
						new GameError('INVALID_BOT_RESPONSE', 'Invalid bot response.'),
					);
				}
			});
			socket.addEventListener('error', () =>
				finish(new GameError('BOT_UNAVAILABLE', 'Bot connection failed.')),
			);
			socket.addEventListener('close', () =>
				finish(
					new GameError('BOT_UNAVAILABLE', 'Bot closed before responding.'),
				),
			);
		});
	}
}
