import { GameClock } from './game-clock.js';

describe('Restoring persistent clocks', () => {
  const control = { initialTime: 60000, increment: 2000 };
  const running = {
    white: 42000,
    black: 50000,
    status: 'RUNNING',
    activeColor: 'BLACK',
    expiredColor: null,
  } as const;

  it('resumes elapsed time and increment without resetting either player', () => {
    const clock = GameClock.restore(control, running, 1000);
    expect(clock.completeMove('BLACK', 3000)).toMatchObject({
      white: 42000,
      black: 50000,
      activeColor: 'WHITE',
    });
    expect(clock.getSnapshot(4000)).toMatchObject({
      white: 41000,
      black: 50000,
    });
  });

  it('starts a custom position on Black rather than charging White', () => {
    const clock = new GameClock(control);
    expect(clock.start(1000, 'BLACK').activeColor).toBe('BLACK');
    expect(clock.getSnapshot(2000)).toMatchObject({
      white: 60000,
      black: 59000,
    });
  });

  it('keeps stopped and expired clocks immutable across a restart', () => {
    const stopped = GameClock.restore(
      control,
      { ...running, status: 'STOPPED', activeColor: null },
      1000,
    );
    expect(stopped.getSnapshot(200000)).toMatchObject({
      white: 42000,
      black: 50000,
      status: 'STOPPED',
    });
    const expired = GameClock.restore(
      control,
      {
        ...running,
        black: 0,
        status: 'EXPIRED',
        activeColor: null,
        expiredColor: 'BLACK',
      },
      1000,
    );
    expect(expired.getSnapshot(200000)).toMatchObject({
      white: 42000,
      black: 0,
      status: 'EXPIRED',
      expiredColor: 'BLACK',
    });
  });

  it.each([
    { ...running, white: -1 },
    { ...running, black: 0.5 },
    { ...running, white: NaN },
    { ...running, activeColor: null },
    { ...running, black: 0 },
    { ...running, expiredColor: 'WHITE' },
    { ...running, status: 'UNKNOWN' },
    { ...running, status: 'STOPPED' },
    { ...running, status: 'EXPIRED', activeColor: null, expiredColor: 'BLACK' },
    { ...running, status: 'WAITING', activeColor: null },
  ])('rejects inconsistent persisted clocks: %j', (snapshot) => {
    expect(() => GameClock.restore(control, snapshot as never, 1000)).toThrow();
  });

  it('rejects invalid persistence timestamps before observing time', () => {
    expect(() => GameClock.restore(control, running, -1)).toThrow();
    expect(() => GameClock.restore(control, running, NaN)).toThrow();
    expect(() =>
      GameClock.restore(control, running, 1000).getSnapshot(999),
    ).toThrow();
  });
});
