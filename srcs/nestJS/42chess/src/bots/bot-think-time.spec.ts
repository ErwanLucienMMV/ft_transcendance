import { BotPacer, thinkTime } from './bot-think-time.js';
import type { ThinkContext } from './bot-think-time.js';

const middle = () => 0.5;
const context = (overrides: Partial<ThinkContext> = {}): ThinkContext => ({
  difficulty: 'MEDIUM',
  legalMoves: 30,
  book: false,
  remainingMs: null,
  ...overrides,
});

describe('Bot think time', () => {
  it('answers book moves and forced replies quickly', () => {
    expect(thinkTime(context({ book: true }), middle)).toBe(350);
    expect(thinkTime(context({ legalMoves: 1 }), middle)).toBe(350);
    expect(thinkTime(context({ book: true }), () => 0)).toBe(210);
    expect(thinkTime(context({ book: true }), () => 1)).toBe(490);
  });

  it('takes longer in busier positions and at higher levels', () => {
    const quiet = thinkTime(context({ legalMoves: 8 }), middle);
    const busy = thinkTime(context({ legalMoves: 45 }), middle);
    expect(quiet).toBe(700);
    expect(busy).toBe(2200);
    expect(thinkTime(context({ difficulty: 'EASY' }), middle)).toBeLessThan(
      thinkTime(context({ difficulty: 'HARD' }), middle),
    );
  });

  it('varies each answer by a quarter either way', () => {
    const slow = thinkTime(context({ legalMoves: 45 }), () => 1);
    const fast = thinkTime(context({ legalMoves: 45 }), () => 0);
    expect(fast).toBe(1650);
    expect(slow).toBe(2750);
  });

  it('never spends more than a fortieth of the remaining clock', () => {
    expect(thinkTime(context({ remainingMs: 4000 }), middle)).toBe(100);
    expect(thinkTime(context({ remainingMs: -50 }), middle)).toBe(0);
  });
});

describe('Bot pacer', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('waits out the think time', async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = new BotPacer().wait(500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });

  it('answers at once when disabled or when the search already took the time', async () => {
    vi.useFakeTimers();
    await new BotPacer().wait(-20);
    vi.stubEnv('BOT_THINK_TIME', 'off');
    await new BotPacer().wait(5000);
  });
});
