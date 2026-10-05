// Run after:
//   npm ci && npm run build
// in ../nestJS/42chess.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { resolve } from 'node:path';

import {
	ChessEngineService,
} from '../../nestJS/42chess/dist/chess/chess-engine.service.js';

async function reservePort() {
	const server = net.createServer();

	server.listen(0, '127.0.0.1');
	await once(server, 'listening');

	const { port } = server.address();

	await new Promise((resolve) => {
		server.close(resolve);
	});

	return port;
}

async function startEngine(binary, port) {
	const server = spawn(
		binary,
		['--port', String(port)],
		{
			stdio: ['ignore', 'pipe', 'inherit'],
		}
	);

	await Promise.race([
		once(server.stdout, 'data'),

		once(server, 'exit').then(() => {
			throw new Error('Engine exited during startup');
		}),

		once(server, 'error').then(([error]) => {
			throw error;
		}),
	]);

	return server;
}

async function stopEngine(server) {
	if (
		server.exitCode === null &&
		server.signalCode === null
	) {
		server.kill('SIGTERM');
		await once(server, 'exit');
	}
}

async function main() {
	const port = await reservePort();

	const binary = resolve(
		process.argv[2] ?? 'build/chess_engine'
	);

	const server = await startEngine(binary, port);

	try {
		process.env.CHESS_ENGINE_URL =
			`ws://127.0.0.1:${port}`;

		const client = new ChessEngineService();

		// -------------------------------------------------------------------------
		// Analysis
		// -------------------------------------------------------------------------

		const initial = await client.analyze();

		assert.equal(
			initial.legalMoves.length,
			20
		);

		// -------------------------------------------------------------------------
		// Move validation
		// -------------------------------------------------------------------------

		const invalidMove =
			await client.validate('e2e5');

		assert.equal(
			invalidMove.legal,
			false
		);

		// -------------------------------------------------------------------------
		// Playing moves
		// -------------------------------------------------------------------------

		const played = await client.move(
			'e7e5',
			{
				moves: ['e2e4'],
			}
		);

		assert.equal(
			played.turn,
			'white'
		);

		assert.match(
			played.fen,
			/ e6 0 2$/
		);

		await assert.rejects(
			client.move('e2e5'),
			/Illegal move/
		);

		// -------------------------------------------------------------------------
		// Concurrent requests
		// -------------------------------------------------------------------------

		const games = await Promise.all(
			Array.from(
				{ length: 8 },
				() => client.analyze()
			)
		);

		assert.ok(
			games.every(
				(game) => game.legalMoves.length === 20
			)
		);

		// -------------------------------------------------------------------------
		// Checkmate
		// -------------------------------------------------------------------------

		const mate = await client.analyze({
			moves: [
				'f2f3',
				'e7e5',
				'g2g4',
				'd8h4',
			],
		});

		assert.equal(
			mate.winner,
			'black'
		);

		// -------------------------------------------------------------------------
		// Engine shutdown
		// -------------------------------------------------------------------------

		server.kill('SIGTERM');
		await once(server, 'exit');

		await assert.rejects(
			client.analyze(),
			/connection failed|closed before responding/
		);

		console.log(
			'PASS compiled NestJS client: ' +
			'analysis, validation, moves, errors, ' +
			'concurrent games, mate and unavailable engine'
		);
	} finally {
		await stopEngine(server);
	}
}

await main();