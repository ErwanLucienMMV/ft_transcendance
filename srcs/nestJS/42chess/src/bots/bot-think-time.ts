import { Injectable } from '@nestjs/common';
import type { BotDifficulty } from './bot-engine.js';

/** Time a level takes to answer, in ms: in a quiet position, and in the busiest one. */
const THINK_TIME: Record<BotDifficulty, readonly [number, number]> = {
  EASY: [500, 1500],
  MEDIUM: [700, 2200],
  HARD: [900, 3000],
};
/** A book move or the only legal reply comes quickly. */
const QUICK_MS = 350;
/** Showing thought never takes more than this share of the bot's remaining clock. */
const CLOCK_SHARE = 1 / 40;

export interface ThinkContext {
  difficulty: BotDifficulty;
  /** Legal moves in the position the bot answers: the fewer, the simpler. */
  legalMoves: number;
  book: boolean;
  /** The bot's remaining clock, or null for an untimed check. */
  remainingMs: number | null;
}

/**
 * How long the bot appears to think before its move is played. A busier position takes longer,
 * and each answer varies by a quarter either way, so the bot does not answer like a metronome.
 */
export function thinkTime(
  context: ThinkContext,
  random: () => number = Math.random,
): number {
  let ms: number;
  if (context.book || context.legalMoves <= 1) {
    ms = QUICK_MS * (0.6 + random() * 0.8);
  } else {
    const [quiet, busy] = THINK_TIME[context.difficulty];
    const load = Math.min(1, Math.max(0, (context.legalMoves - 10) / 30));
    ms = (quiet + (busy - quiet) * load) * (0.75 + random() * 0.5);
  }
  if (context.remainingMs !== null)
    ms = Math.min(ms, Math.max(0, context.remainingMs) * CLOCK_SHARE);
  return Math.round(ms);
}

/** Waits out the rest of the think time. BOT_THINK_TIME=off answers at once (tests). */
@Injectable()
export class BotPacer {
  private readonly enabled = process.env.BOT_THINK_TIME !== 'off';

  async wait(ms: number): Promise<void> {
    if (!this.enabled || ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
