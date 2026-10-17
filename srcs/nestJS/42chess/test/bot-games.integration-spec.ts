import { gameFixture } from './game-service.fixture.js';
import { NativeBotAdapter } from '../dist/bots/native-bot.adapter.js';
import { GamesService } from '../dist/games/games.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameRulesService } from '../dist/games/game-rules.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { GameAgreementsService } from '../dist/games/game-agreements.service.js';
import { GamePresenterService } from '../dist/games/game-presenter.service.js';

// Real PostgreSQL, bot executable and rules executable. No search/repository mocks.
describe('Persisted bot games', () => {
	const fixture = gameFixture();
	for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
		it(`persists a legal ${difficulty} reply with contiguous history and notation`, async () => {
			const initial = await fixture.service.createBot(
				fixture.white,
				{ initialTime: 300000 },
				difficulty,
			);
			const state = await fixture.service.play(
				fixture.white,
				initial.game.id,
				'e2e4',
			);
			expect(state.moves).toHaveLength(2);
			expect(state.moves.map((move) => move.ply)).toEqual([1, 2]);
			expect(state.moves[1].color).toBe('BLACK');
			expect(state.moves[1].notation).toBeTruthy();
			expect(state.game.turn).toBe('WHITE');
			expect(
				state.players.find((seat) => seat.botDifficulty)?.userId,
			).toBeNull();
			expect(
				(
					await fixture.engine.analyze({
						fen: state.game.initialFen,
						moves: state.moves.map((move) => move.uci),
					})
				).fen,
			).toBe(state.game.currentFen);
			// Restarting the game service does not lose state or duplicate an accepted bot move.
			const store = new GameStoreService(fixture.source),
				clocks = new GameClocksService();
			const restarted = new GamesService(
				store,
				new GameRulesService(fixture.engine),
				new GameAgreementsService(store, clocks),
				clocks,
				new NativeBotAdapter(),
			);
			expect(
				(await restarted.resumeBot(fixture.white, state.game.id)).moves,
			).toHaveLength(2);
			const presenter = new GamePresenterService(fixture.source);
			const publicState = await presenter.state(state);
			expect(publicState.blackPlayer?.botDifficulty).toBe(difficulty);
			expect(publicState.blackPlayer?.elo).toBeNull();
			expect(presenter.moves(state).moves[1].playerId).toBe(
				state.players.find((seat) => seat.botDifficulty)!.id,
			);
		});
	}
	it('supports a bot playing White and a participant retrying its first turn', async () => {
		const state = await fixture.service.createBot(
			fixture.white,
			{ initialTime: 300000, color: 'BLACK' },
			'MEDIUM',
		);
		await expect(
			fixture.service.play(fixture.white, state.game.id, 'e7e5'),
		).rejects.toMatchObject({ code: 'WRONG_TURN' });
		expect(
			(await fixture.service.resumeBot(fixture.white, state.game.id)).moves,
		).toHaveLength(1);
	});
	it('rejects unaffiliated callers and malformed difficulty', async () => {
		const state = await fixture.service.createBot(
			fixture.white,
			{ initialTime: 300000, color: 'BLACK' },
			'EASY',
		);
		await expect(
			fixture.service.resumeBot(fixture.outsider, state.game.id),
		).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
		await expect(
			fixture.service.createBot(
				fixture.white,
				{ initialTime: 300000 },
				'EXPERT' as never,
			),
		).rejects.toMatchObject({ code: 'INVALID_GAME_INPUT' });
	});
	it('blocks human moves and duplicate calculations while the DB game lock is held', async () => {
		const state = await fixture.service.createBot(
			fixture.white,
			{ initialTime: 300000 },
			'EASY',
		);
		const runner = fixture.source.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await runner.query('SELECT id FROM games WHERE id=$1 FOR UPDATE', [
				state.game.id,
			]);
			await expect(
				fixture.service.play(fixture.white, state.game.id, 'e2e4'),
			).rejects.toMatchObject({ code: 'GAME_BUSY' });
			await expect(
				fixture.service.resumeBot(fixture.white, state.game.id),
			).rejects.toMatchObject({ code: 'GAME_BUSY' });
			expect(await fixture.count('moves')).toBe(0);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}
	});
	it('keeps a human move durable after bot failure and retries only the bot turn', async () => {
		const original = process.env.BOT_ENGINE_URL;
		try {
			process.env.BOT_ENGINE_URL = 'ws://127.0.0.1:1';
			const state = await fixture.service.createBot(
				fixture.white,
				{ initialTime: 300000 },
				'EASY',
			);
			await expect(
				fixture.service.play(fixture.white, state.game.id, 'e2e4'),
			).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
			const saved = await fixture.service.get(state.game.id);
			expect(saved.moves.map((move) => move.uci)).toEqual(['e2e4']);
			expect(saved.game.turn).toBe('BLACK');
			process.env.BOT_ENGINE_URL = original;
			expect(
				(await fixture.service.resumeBot(fixture.white, state.game.id)).moves,
			).toHaveLength(2);
		} finally {
			process.env.BOT_ENGINE_URL = original;
		}
	});
	it('checks human-or-bot seat exclusivity in PostgreSQL', async () => {
		const state = await fixture.service.createBot(
			fixture.white,
			{ initialTime: 300000 },
			'EASY',
		);
		const bot = state.players.find((seat) => seat.botDifficulty)!;
		await expect(
			fixture.source.query('UPDATE game_players SET "userId"=$1 WHERE id=$2', [
				fixture.black,
				bot.id,
			]),
		).rejects.toThrow();
		await expect(
			fixture.source.query(
				'UPDATE game_players SET "botDifficulty"=NULL WHERE id=$1',
				[bot.id],
			),
		).rejects.toThrow();
		await expect(
			fixture.source.query(
				`UPDATE game_players SET "botDifficulty"='EXPERT' WHERE id=$1`,
				[bot.id],
			),
		).rejects.toThrow();
	});
});
