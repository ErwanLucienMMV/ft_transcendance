import type { GameMove, GamePlayer, GameResult } from '../../core/realtime/game-realtime';
import { parseFen, sanOf } from './chess-rules';
import { START_FEN } from './game-text';

export interface PgnGame {
  id: string;
  whitePlayer: GamePlayer | null;
  blackPlayer: GamePlayer | null;
  rated?: boolean;
  timeControl: { initialTime: number; increment: number };
  result: GameResult | null;
  startedAt: string | null;
  createdAt?: string;
}

const TERMINATIONS: Record<string, string> = {
  TIMEOUT: 'time forfeit',
  ABANDONED: 'abandoned',
  ABORTED: 'unterminated',
};

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function playerName(player: GamePlayer | null): string {
  if (!player) return '?';
  if (player.botDifficulty) return `Computer (${player.botDifficulty.toLowerCase()})`;
  return player.username.startsWith('deleted_') ? 'Deleted player' : player.username;
}

/** "1-0", "0-1", "1/2-1/2", or "*" for a game in progress or aborted. */
export function pgnResult(result: GameResult | null): string {
  if (!result || result.reason === 'ABORTED') return '*';
  if (!result.winner) return '1/2-1/2';
  return result.winner === 'WHITE' ? '1-0' : '0-1';
}

/**
 * The game in PGN, the format every chess program reads. Moves stored without notation
 * (older games) are written from their positions.
 */
export function gamePgn(game: PgnGame, moves: readonly GameMove[], site = '42 Chess'): string {
  const when = game.startedAt ?? game.createdAt;
  // PGN writes an unknown date as question marks.
  const date = when ? when.slice(0, 10).replace(/-/g, '.') : '????.??.??';
  const result = pgnResult(game.result);
  const headers: [string, string][] = [
    ['Event', game.rated ? 'Rated game' : 'Casual game'],
    ['Site', site],
    ['Date', date],
    ['Round', '-'],
    ['White', playerName(game.whitePlayer)],
    ['Black', playerName(game.blackPlayer)],
    ['Result', result],
  ];
  for (const [tag, player] of [
    ['WhiteElo', game.whitePlayer],
    ['BlackElo', game.blackPlayer],
  ] as const)
    if (player?.elo != null && !player.botDifficulty) headers.push([tag, String(player.elo)]);
  headers.push([
    'TimeControl',
    `${game.timeControl.initialTime / 1000}+${game.timeControl.increment / 1000}`,
  ]);
  const termination = game.result?.reason ? TERMINATIONS[game.result.reason] : undefined;
  headers.push(['Termination', termination ?? (game.result ? 'normal' : 'unterminated')]);
  headers.push(['GameId', game.id]);

  const tokens: string[] = [];
  let fen = START_FEN;
  for (const move of moves) {
    let san = move.notation;
    if (!san) {
      try {
        san = sanOf(parseFen(fen), {
          from: move.from,
          to: move.to,
          promotion: move.promotion?.[0].toLowerCase() as 'q' | 'r' | 'b' | 'n' | undefined,
        });
      } catch {
        san = `${move.from}${move.to}`;
      }
    }
    if (move.number % 2 === 1) tokens.push(`${(move.number + 1) / 2}.`);
    else if (tokens.length === 0) tokens.push(`${move.number / 2}...`);
    tokens.push(san);
    fen = move.fen;
  }
  tokens.push(result);
  // Lines of at most 80 characters, as the standard asks.
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > 80) {
      lines.push(line);
      line = token;
    } else line = line ? `${line} ${token}` : token;
  }
  if (line) lines.push(line);
  return `${headers.map(([tag, value]) => `[${tag} ${quoted(value)}]`).join('\n')}\n\n${lines.join('\n')}\n`;
}

/** Saves the PGN as a file, named after the players and the date. */
export function downloadPgn(pgn: string, name: string, document: Document): void {
  const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^\w.-]+/g, '_')}.pgn`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers read the file after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
