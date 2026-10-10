import { ClockError, GameClock } from './game-clock.js';

describe('GameClock', () => {
  it('gives both players their initial time without charging a waiting game', () => {
    const clock = new GameClock({ initialTime: 60000, increment: 2000 });
    expect(clock.getSnapshot(30000)).toEqual({
      white: 60000,
      black: 60000,
      activeColor: null,
      status: 'WAITING',
      expiredColor: null,
    });
    expect(clock.start(40000)).toMatchObject({
      white: 60000,
      black: 60000,
      activeColor: 'WHITE',
      status: 'RUNNING',
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid initial time %s',
    (initialTime) => {
      expect(() => new GameClock({ initialTime, increment: 0 })).toThrow(
        ClockError,
      );
    },
  );

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid increment %s',
    (increment) => {
      expect(() => new GameClock({ initialTime: 1000, increment })).toThrow(
        ClockError,
      );
    },
  );

  it('charges only the active player, including across multiple reads', () => {
    const clock = new GameClock({ initialTime: 10000, increment: 0 });
    clock.start(1000);
    expect(clock.getSnapshot(1500)).toMatchObject({
      white: 9500,
      black: 10000,
    });
    expect(clock.getSnapshot(2500)).toMatchObject({
      white: 8500,
      black: 10000,
    });
    expect(clock.getSnapshot(2500)).toMatchObject({
      white: 8500,
      black: 10000,
    });
  });

  it('changes turns and grants Fischer increment to the player who just moved', () => {
    const clock = new GameClock({ initialTime: 10000, increment: 2000 });
    clock.start(1000);
    expect(clock.completeMove('WHITE', 2500)).toMatchObject({
      white: 10500,
      black: 10000,
      activeColor: 'BLACK',
    });
    expect(clock.completeMove('BLACK', 6000)).toMatchObject({
      white: 10500,
      black: 8500,
      activeColor: 'WHITE',
    });
    expect(clock.getSnapshot(7000)).toMatchObject({ white: 9500, black: 8500 });
  });

  it('does not grant increment on start or on reads', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 500 });
    expect(clock.start(0).white).toBe(1000);
    expect(clock.getSnapshot(0).white).toBe(1000);
    expect(clock.getSnapshot(100).white).toBe(900);
  });

  it('supports zero increment without resetting the opponent clock', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 0 });
    clock.start(0);
    expect(clock.completeMove('WHITE', 200)).toMatchObject({
      white: 800,
      black: 1000,
    });
    expect(clock.completeMove('BLACK', 500)).toMatchObject({
      white: 800,
      black: 700,
    });
    expect(clock.completeMove('WHITE', 600)).toMatchObject({
      white: 700,
      black: 700,
    });
  });

  it('rejects a wrong-turn move and does not switch clocks or grant increment', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 100 });
    clock.start(0);
    expect(() => clock.completeMove('BLACK', 100)).toThrow(
      expect.objectContaining({ code: 'WRONG_TURN' }),
    );
    expect(clock.getSnapshot(100)).toMatchObject({
      white: 900,
      black: 1000,
      activeColor: 'WHITE',
    });
  });

  it('rejects an immediate duplicate move without granting increment twice', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 100 });
    clock.start(0);
    clock.completeMove('WHITE', 100);
    expect(() => clock.completeMove('WHITE', 100)).toThrow(ClockError);
    expect(clock.getSnapshot(100)).toMatchObject({
      white: 1000,
      black: 1000,
      activeColor: 'BLACK',
    });
  });

  it('does not expire one millisecond before the deadline', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 100 });
    clock.start(10);
    expect(clock.completeMove('WHITE', 1009)).toMatchObject({
      white: 101,
      activeColor: 'BLACK',
      status: 'RUNNING',
    });
  });

  it.each([1000, 1001, 600000])(
    'detects expiry at or after the deadline: %s',
    (now) => {
      const clock = new GameClock({ initialTime: 1000, increment: 100 });
      clock.start(0);
      expect(clock.completeMove('WHITE', now)).toEqual({
        white: 0,
        black: 1000,
        activeColor: null,
        status: 'EXPIRED',
        expiredColor: 'WHITE',
      });
    },
  );

  it('detects expiry on reads without waiting for a move', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 0 });
    clock.start(0);
    expect(clock.getSnapshot(1000)).toMatchObject({
      white: 0,
      status: 'EXPIRED',
      expiredColor: 'WHITE',
    });
  });

  it('detects black expiry and preserves white remaining time', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 0 });
    clock.start(0);
    clock.completeMove('WHITE', 100);
    expect(clock.getSnapshot(1100)).toMatchObject({
      white: 900,
      black: 0,
      expiredColor: 'BLACK',
      status: 'EXPIRED',
    });
  });

  it('cannot revive an expired clock, reset it or grant a late increment', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 500 });
    clock.start(0);
    const expired = clock.getSnapshot(1000);
    expect(clock.getSnapshot(100000)).toEqual(expired);
    expect(clock.stop(100000)).toEqual(expired);
    expect(() => clock.start(100000)).toThrow(ClockError);
    expect(() => clock.completeMove('WHITE', 100000)).toThrow(ClockError);
  });

  it('freezes both clocks when the game ends', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 100 });
    clock.start(0);
    const stopped = clock.stop(200);
    expect(stopped).toEqual({
      white: 800,
      black: 1000,
      activeColor: null,
      status: 'STOPPED',
      expiredColor: null,
    });
    expect(clock.getSnapshot(5000)).toEqual(stopped);
    expect(clock.stop(5000)).toEqual(stopped);
    expect(() => clock.completeMove('WHITE', 5000)).toThrow(ClockError);
    expect(() => clock.start(5000)).toThrow(ClockError);
  });

  it('can cancel a waiting clock without consuming time', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 0 });
    expect(clock.stop(5000)).toMatchObject({
      white: 1000,
      black: 1000,
      status: 'STOPPED',
    });
    expect(() => clock.start(5000)).toThrow(ClockError);
  });

  it('rejects moves before start and repeated starts', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 0 });
    expect(() => clock.completeMove('WHITE', 0)).toThrow(ClockError);
    clock.start(0);
    expect(() => clock.start(100)).toThrow(ClockError);
    expect(clock.getSnapshot(100).white).toBe(900);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid server timestamp %s without starting',
    (now) => {
      const clock = new GameClock({ initialTime: 1000, increment: 0 });
      expect(() => clock.start(now)).toThrow(
        expect.objectContaining({ code: 'INVALID_TIMESTAMP' }),
      );
      expect(clock.start(0).status).toBe('RUNNING');
    },
  );

  it('rejects backwards timestamps without granting time back', () => {
    const clock = new GameClock({ initialTime: 1000, increment: 0 });
    clock.start(100);
    clock.getSnapshot(200);
    expect(() => clock.getSnapshot(199)).toThrow(ClockError);
    expect(() => clock.completeMove('WHITE', 199)).toThrow(ClockError);
    expect(() => clock.stop(199)).toThrow(ClockError);
    expect(clock.getSnapshot(250).white).toBe(850);
  });

  it('copies the time control and returns immutable snapshots', () => {
    const control = { initialTime: 1000, increment: 100 };
    const clock = new GameClock(control);
    control.initialTime = 5000;
    control.increment = 1000;
    const initial = clock.start(0);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(clock.timeControl)).toBe(true);
    expect(clock.completeMove('WHITE', 100).white).toBe(1000);
    expect(initial).toMatchObject({ white: 1000, activeColor: 'WHITE' });
  });

  it('rejects increment overflow without switching turn or partially committing the move', () => {
    const clock = new GameClock({
      initialTime: Number.MAX_SAFE_INTEGER,
      increment: 2,
    });
    clock.start(0);
    expect(() => clock.completeMove('WHITE', 1)).toThrow(
      expect.objectContaining({ code: 'TIME_OVERFLOW' }),
    );
    expect(clock.getSnapshot(1)).toMatchObject({
      white: Number.MAX_SAFE_INTEGER - 1,
      activeColor: 'WHITE',
    });
  });

  it('produces the same result whether elapsed time is read once or in small steps', () => {
    const direct = new GameClock({ initialTime: 10000, increment: 500 });
    const observed = new GameClock({ initialTime: 10000, increment: 500 });
    direct.start(0);
    observed.start(0);
    for (let now = 1; now < 1000; now++) observed.getSnapshot(now);
    expect(observed.completeMove('WHITE', 1000)).toEqual(
      direct.completeMove('WHITE', 1000),
    );
    expect(observed.getSnapshot(11000)).toEqual(direct.getSnapshot(11000));
  });
});
