import { describe, expect, it } from 'vitest';
import {
  areCompatible,
  compareQueueOrder,
  eloWindow,
  type MatchmakingCandidate,
} from './matchmaking.policy.js';

const now = new Date('2026-10-26T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const candidate = (
  changes: Partial<MatchmakingCandidate> = {},
): MatchmakingCandidate => ({
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000011',
  rating: 1200,
  initialTime: 180_000,
  increment: 2_000,
  status: 'WAITING',
  createdAt: ago(0),
  ...changes,
});
const opponent = (
  changes: Partial<MatchmakingCandidate> = {},
): MatchmakingCandidate =>
  candidate({
    id: '00000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-000000000012',
    ...changes,
  });

describe('matchmaking Elo window', () => {
  it.each([
    [-30_000, 100],
    [0, 100],
    [29_999, 100],
    [30_000, 150],
    [30_001, 150],
    [59_999, 150],
    [60_000, 200],
    [179_999, 350],
    [180_000, 400],
    [180_001, 400],
    [86_400_000, 400],
  ])('wait age %i ms permits %i Elo', (age, expected) => {
    expect(eloWindow(ago(age), now)).toBe(expected);
  });

  it('rejects invalid timestamps instead of silently granting a window', () => {
    expect(() => eloWindow(new Date(NaN), now)).toThrow(RangeError);
    expect(() => eloWindow(ago(0), new Date(NaN))).toThrow(RangeError);
  });
});

describe('matchmaking compatibility', () => {
  it.each([-101, -100, 0, 100, 101])(
    'uses inclusive Elo distance in both directions (gap %i)',
    (gap) => {
      const left = candidate();
      const right = opponent({ rating: left.rating + gap });
      const expected = Math.abs(gap) <= 100;
      expect(areCompatible(left, right, now)).toBe(expected);
      expect(areCompatible(right, left, now)).toBe(expected);
    },
  );

  it('requires both wait windows to accept the gap at the exact widening time', () => {
    const left = candidate({ createdAt: ago(180_000) });
    const right = opponent({ rating: 1350, createdAt: ago(29_999) });
    expect(areCompatible(left, right, now)).toBe(false);
    expect(areCompatible(right, left, now)).toBe(false);
    const nextTick = new Date(now.getTime() + 1);
    expect(areCompatible(left, right, nextTick)).toBe(true);
    expect(areCompatible(right, left, nextTick)).toBe(true);
  });

  it('never widens beyond 400 Elo, even after a day', () => {
    const left = candidate({ createdAt: ago(86_400_000) });
    expect(
      areCompatible(
        left,
        opponent({ rating: 1600, createdAt: left.createdAt }),
        now,
      ),
    ).toBe(true);
    expect(
      areCompatible(
        left,
        opponent({ rating: 1601, createdAt: left.createdAt }),
        now,
      ),
    ).toBe(false);
  });

  it('does not give future-dated entries extra tolerance', () => {
    expect(
      areCompatible(
        candidate({ createdAt: ago(-30_000) }),
        opponent({ rating: 1301, createdAt: ago(180_000) }),
        now,
      ),
    ).toBe(false);
  });

  it.each([{ initialTime: 180 }, { initialTime: 180_001 }, { increment: 0 }])(
    'requires exact millisecond time control values: %j',
    (changes) => {
      expect(areCompatible(candidate(), opponent(changes), now)).toBe(false);
    },
  );

  it('accepts matching controls including zero increment and Elo', () => {
    expect(
      areCompatible(
        candidate({ rating: 0, increment: 0 }),
        opponent({ rating: 0, increment: 0 }),
        now,
      ),
    ).toBe(true);
  });

  it('rejects the same row and the same user in distinct rows', () => {
    const left = candidate();
    expect(areCompatible(left, left, now)).toBe(false);
    expect(areCompatible(left, opponent({ userId: left.userId }), now)).toBe(
      false,
    );
    expect(areCompatible(left, opponent({ id: left.id }), now)).toBe(false);
  });

  it.each(['MATCHED', 'CANCELLED'] as const)(
    'rejects %s entries on either side',
    (status) => {
      expect(areCompatible(candidate({ status }), opponent(), now)).toBe(false);
      expect(areCompatible(candidate(), opponent({ status }), now)).toBe(false);
    },
  );
});

describe('matchmaking FIFO order', () => {
  it('uses creation time before UUID and breaks equal-time ties by UUID', () => {
    const oldest = opponent({ createdAt: ago(2), rating: 1600 });
    const tiedFirst = candidate({ createdAt: ago(1) });
    const tiedSecond = opponent({ createdAt: ago(1) });
    const latest = candidate();
    expect(
      [latest, tiedSecond, oldest, tiedFirst].sort(compareQueueOrder),
    ).toEqual([oldest, tiedFirst, tiedSecond, latest]);
    expect(compareQueueOrder(tiedFirst, tiedSecond)).toBeLessThan(0);
    expect(compareQueueOrder(tiedSecond, tiedFirst)).toBeGreaterThan(0);
    expect(compareQueueOrder(tiedFirst, tiedFirst)).toBe(0);
  });

  it('composes with compatibility filtering without mutating the input', () => {
    const left = candidate();
    const recent = opponent();
    const oldest = opponent({
      id: '00000000-0000-4000-8000-000000000003',
      createdAt: ago(1),
    });
    const excluded = opponent({ createdAt: ago(2), increment: 0 });
    const entries = Object.freeze([recent, excluded, oldest, left]);
    const eligible = entries
      .filter((entry) => areCompatible(left, entry, now))
      .sort(compareQueueOrder);
    expect(eligible).toEqual([oldest, recent]);
    expect(entries).toEqual([recent, excluded, oldest, left]);
  });

  it('rejects invalid FIFO timestamps', () => {
    expect(() =>
      compareQueueOrder(candidate({ createdAt: new Date(NaN) }), opponent()),
    ).toThrow(RangeError);
  });
});
