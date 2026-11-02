import { GameClockSync, type ClockSample } from './game-clock-sync';
describe('Server clock display synchronization', () => {
  const sample: ClockSample = {
    clocks: { white: 5000, black: 6000 },
    serverTime: '2026-10-28T10:00:00.000Z',
    clockStatus: 'RUNNING',
    turn: 'WHITE',
    status: 'ACTIVE',
  };
  it('compensates network latency and server processing using a monotonic clock', () => {
    const clock = new GameClockSync();
    expect(clock.synchronize(sample, 100, 400, 100, 50)).toBe(true);
    expect(clock.project(400)).toEqual({ white: 4850, black: 6000 });
    expect(clock.project(1400)).toEqual({ white: 3850, black: 6000 });
    expect(clock.project(100000)).toEqual({ white: 0, black: 6000 });
  });
  it('reanchors the next turn and accepts increment from the server', () => {
    const clock = new GameClockSync();
    clock.synchronize(sample, 0, 0, 0, 0);
    clock.accept({
      ...sample,
      clocks: { white: 6500, black: 6000 },
      turn: 'BLACK',
      serverTime: '2026-10-28T10:00:01.000Z',
    });
    expect(clock.project(1500)).toEqual({ white: 6500, black: 5500 });
    expect(clock.accept(sample)).toBe(false);
  });
  it('freezes stopped, waiting, expired and finished clocks', () => {
    for (const clockStatus of ['WAITING', 'STOPPED', 'EXPIRED']) {
      const clock = new GameClockSync();
      clock.synchronize({ ...sample, clockStatus }, 0, 0, 0, 0);
      expect(clock.project(10000)).toEqual(sample.clocks);
    }
    const clock = new GameClockSync();
    clock.synchronize({ ...sample, status: 'FINISHED' }, 0, 0, 0, 0);
    expect(clock.project(10000)).toEqual(sample.clocks);
  });
  it('discards the prior time base on reconnect and rejects invalid samples', () => {
    const clock = new GameClockSync();
    clock.synchronize(sample, 0, 0, 0, 0);
    clock.reset();
    expect(clock.project(1000)).toBeNull();
    clock.accept(sample);
    expect(clock.project(1000)).toEqual(sample.clocks);
    expect(clock.synchronize(sample, 0, 100, -1, 0)).toBe(false);
    expect(clock.accept({ ...sample, clocks: { white: NaN, black: 1 } })).toBe(false);
  });
});
