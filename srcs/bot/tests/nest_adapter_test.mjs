// Use TEST_* endpoints in Docker, or launch both local daemons from any cwd.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const dist =
	process.env.NEST_DIST_DIR ??
	fileURLToPath(new URL("../../nestJS/42chess/dist/", import.meta.url));
const { NativeBotAdapter } = await import(
	pathToFileURL(resolve(dist, "bots/native-bot.adapter.js"))
);
const { ChessEngineService } = await import(
	pathToFileURL(resolve(dist, "chess/chess-engine.service.js"))
);
const children = [];
async function start(binary) {
	const reservation = net.createServer().listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const { port } = reservation.address();
	await new Promise((resolve) => reservation.close(resolve));
	const process = spawn(resolve(repoRoot, binary), ["--port", String(port)], {
		stdio: ["ignore", "pipe", "inherit"],
	});
	children.push(process);
	let spawnError;
	process.once("error", (error) => {
		spawnError = error;
	});
	for (let attempt = 0; attempt < 100; ++attempt) {
		if (spawnError) throw spawnError;
		if (process.exitCode !== null)
			throw new Error("Daemon exited during startup");
		const connected = await new Promise((resolve) => {
			const socket = net.createConnection({ host: "127.0.0.1", port });
			socket.once("connect", () => {
				socket.destroy();
				resolve(true);
			});
			socket.once("error", () => {
				socket.destroy();
				resolve(false);
			});
		});
		if (connected) return port;
		await delay(25);
	}
	throw new Error("Daemon readiness timed out");
}
try {
	const externalBot =
		process.env.TEST_BOT_ENGINE_URL ?? process.env.BOT_ENGINE_URL;
	const externalRules =
		process.env.TEST_CHESS_ENGINE_URL ?? process.env.CHESS_ENGINE_URL;
	if (!!externalBot !== !!externalRules)
		throw new Error("Supply both bot and rules endpoints, or neither");
	if (externalBot && externalRules) {
		process.env.BOT_ENGINE_URL = externalBot;
		process.env.CHESS_ENGINE_URL = externalRules;
	} else {
		const botPort = await start("srcs/bot/build/chess_bot");
		const enginePort = await start("srcs/chess-engine/build/chess_engine");
		process.env.BOT_ENGINE_URL = `ws://127.0.0.1:${botPort}`;
		process.env.CHESS_ENGINE_URL = `ws://127.0.0.1:${enginePort}`;
	}
	const bot = new NativeBotAdapter(),
		rules = new ChessEngineService();
	for (const difficulty of ["EASY", "MEDIUM", "HARD"]) {
		const result = await bot.bestMove({ moves: ["e2e4"] }, difficulty);
		assert.equal(
			(await rules.validate(result.bestMove, { moves: ["e2e4"] })).legal,
			true,
		);
		assert.equal(
			(await rules.move(result.bestMove, { moves: ["e2e4"] })).fen,
			result.fenAfter,
		);
	}
	await assert.rejects(bot.bestMove({ fen: "invalid" }, "EASY"), {
		code: "BOT_UNAVAILABLE",
	});
	await assert.rejects(bot.bestMove({}, "EXPERT"), {
		code: "INVALID_GAME_INPUT",
	});
	const noMove = await bot.bestMove(
		{ fen: "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1" },
		"HARD",
	);
	assert.equal(noMove.bestMove, null);
	if (children[0]) {
		const exited = once(children[0], "exit");
		children[0].kill("SIGTERM");
		await exited;
		await assert.rejects(bot.bestMove({}, "EASY"), {
			code: "BOT_UNAVAILABLE",
		});
	}
	console.log(
		"PASS compiled NestJS bot adapter against both real daemons: all difficulties, legality, FEN, errors, terminal states" +
			(children.length ? ", disconnect" : " (external endpoints)"),
	);
} finally {
	await Promise.all(
		children.map(async (child) => {
			if (child.exitCode === null && child.signalCode === null) {
				const exit = once(child, "exit");
				child.kill("SIGTERM");
				await exit;
			}
		}),
	);
}
