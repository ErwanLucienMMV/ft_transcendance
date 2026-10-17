import type { ChessPosition } from '../chess/chess-engine.service.js';
export const BOT_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];
export interface BotMove {
	bestMove: string | null;
	fen: string;
	fenAfter: string | null;
	difficulty: BotDifficulty;
	status: 'ongoing' | 'checkmate' | 'stalemate' | 'insufficient_material';
	scoreCp: number;
	depth: number;
	nodes: number;
	elapsedMs: number;
}
/** Search is replaceable; the game rules service remains the legality authority. */
export abstract class BotEngine {
	abstract bestMove(
		position: ChessPosition,
		difficulty: BotDifficulty,
	): Promise<BotMove>;
}
