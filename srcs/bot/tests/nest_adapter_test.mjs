// Run after building NestJS and both C++ daemons, from the repository root.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeBotAdapter } from '../../nestJS/42chess/dist/bots/native-bot.adapter.js';
import { ChessEngineService } from '../../nestJS/42chess/dist/chess/chess-engine.service.js';
const children = [];
async function start(binary) {
  const reservation = net.createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const process = spawn(resolve(binary), ['--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(process);
  let spawnError;
  process.once('error', error => { spawnError = error; });
  for (let attempt = 0; attempt < 100; ++attempt) {
    if (spawnError) throw spawnError;
    if (process.exitCode !== null) throw new Error('Daemon exited during startup');
    const connected = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
    if (connected) return port;
    await delay(25);
  }
  throw new Error('Daemon readiness timed out');
}
try {
  const botPort = await start('srcs/bot/build/chess_bot');
  const enginePort = await start('srcs/chess-engine/build/chess_engine');
  process.env.BOT_ENGINE_URL = `ws://127.0.0.1:${botPort}`;
  process.env.CHESS_ENGINE_URL = `ws://127.0.0.1:${enginePort}`;
  const bot = new NativeBotAdapter(), rules = new ChessEngineService();
  for (const difficulty of ['EASY', 'MEDIUM', 'HARD']) {
    const result = await bot.bestMove({ moves: ['e2e4'] }, difficulty);
    assert.equal((await rules.validate(result.bestMove, { moves: ['e2e4'] })).legal, true);
    assert.equal((await rules.move(result.bestMove, { moves: ['e2e4'] })).fen, result.fenAfter);
  }
  await assert.rejects(bot.bestMove({ fen: 'invalid' }, 'EASY'), { code: 'BOT_UNAVAILABLE' });
  await assert.rejects(bot.bestMove({}, 'EXPERT'), { code: 'INVALID_GAME_INPUT' });
  const noMove = await bot.bestMove({ fen: '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1' }, 'HARD');
  assert.equal(noMove.bestMove, null);
  const exited = once(children[0], 'exit');
  children[0].kill('SIGTERM'); await exited;
  await assert.rejects(bot.bestMove({}, 'EASY'), { code: 'BOT_UNAVAILABLE' });
  console.log('PASS compiled NestJS bot adapter against both real daemons: all difficulties, legality, FEN, errors, terminal states and disconnect');
} finally {
  await Promise.all(children.map(async child => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
    }
  }));
}
