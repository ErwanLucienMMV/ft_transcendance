import type { BotDifficulty } from '../bots/bot-engine.js';

/** Today's UTC date in SQL, from PostgreSQL's clock: shared by every API replica. */
export const TODAY_SQL = `(clock_timestamp() AT TIME ZONE 'UTC')::date`;

/**
 * Every number a player can earn, in one place: the API serves this table to the
 * "Progression rules" page, so the page and the awards cannot disagree.
 */
export const XP_RULES = {
  /** Games against another player, rated or casual. */
  game: { win: 30, draw: 15, loss: 10 },
  /** Games against the computer; a loss earns nothing. */
  bot: {
    EASY: { win: 10, draw: 5 },
    MEDIUM: { win: 20, draw: 10 },
    HARD: { win: 40, draw: 20 },
  } satisfies Record<BotDifficulty, { win: number; draw: number }>,
  /** A game earns XP once each side has made this many moves (plies / 2). */
  minimumMovesEach: 2,
  /** Puzzles solved on the first and only attempt, without revealing the solution. */
  puzzle: { daily: 20, archive: 10 },
  /** A hint halves the puzzle XP (rounded down). */
  hintDivisor: 2,
  /** Daily puzzle bonus: this much per day of streak, counted up to the cap. */
  streakBonusPerDay: 5,
  streakBonusCap: 7,
  /** Wrong moves that end a puzzle attempt. */
  maxPuzzleMistakes: 3,
} as const;

export type AchievementMetric =
  | 'HUMAN_GAMES'
  | 'HUMAN_WINS'
  | 'BOT_EASY_WINS'
  | 'BOT_MEDIUM_WINS'
  | 'BOT_HARD_WINS'
  | 'PUZZLES_SOLVED'
  | 'PUZZLE_STREAK'
  | 'RATING'
  | 'LEVEL';

/** Total XP needed to reach a level: 0, 100, 300, 600, 1000… (50 × n × (n − 1)). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFor(xp: number): number {
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2));
  // Guard against floating point at exact thresholds.
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  return level;
}

export interface LevelProgress {
  xp: number;
  level: number;
  /** XP at which the current level started and the next one starts. */
  levelXp: number;
  nextLevelXp: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFor(xp);
  return {
    xp,
    level,
    levelXp: xpForLevel(level),
    nextLevelXp: xpForLevel(level + 1),
  };
}

export type GameOutcome = 'win' | 'draw' | 'loss';

/** XP for one finished game, or 0 when it is too short to count. */
export function gameXp(
  outcome: GameOutcome,
  plies: number,
  bot: BotDifficulty | null,
): number {
  if (plies < XP_RULES.minimumMovesEach * 2) return 0;
  if (bot === null) return XP_RULES.game[outcome];
  return outcome === 'loss' ? 0 : XP_RULES.bot[bot][outcome];
}

/** XP for a puzzle solved on its only attempt. */
export function puzzleXp(
  daily: boolean,
  hintUsed: boolean,
  streak: number,
): number {
  const base = daily ? XP_RULES.puzzle.daily : XP_RULES.puzzle.archive;
  const earned = hintUsed ? Math.floor(base / XP_RULES.hintDivisor) : base;
  const bonus = daily
    ? XP_RULES.streakBonusPerDay * Math.min(streak, XP_RULES.streakBonusCap)
    : 0;
  return earned + bonus;
}
