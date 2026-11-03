import {
  gameXp,
  levelFor,
  levelProgress,
  puzzleXp,
  XP_RULES,
  xpForLevel,
} from './progression.rules.js';

describe('progression rules', () => {
  it('needs 100, 300, 600 then 1000 XP for levels 2 to 5', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000]);
  });

  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [999, 4],
    [1000, 5],
    [4500, 10],
    [4499, 9],
  ])('puts %i XP at level %i', (xp, level) => {
    expect(levelFor(xp)).toBe(level);
  });

  it('reports the bounds of the current level', () => {
    expect(levelProgress(150)).toEqual({
      xp: 150,
      level: 2,
      levelXp: 100,
      nextLevelXp: 300,
    });
  });

  it('pays games against players, a loss included', () => {
    expect(gameXp('win', 40, null)).toBe(30);
    expect(gameXp('draw', 40, null)).toBe(15);
    expect(gameXp('loss', 40, null)).toBe(10);
  });

  it('pays wins and draws against the computer by level, never a loss', () => {
    expect(gameXp('win', 10, 'EASY')).toBe(10);
    expect(gameXp('win', 10, 'HARD')).toBe(40);
    expect(gameXp('draw', 10, 'MEDIUM')).toBe(10);
    expect(gameXp('loss', 10, 'HARD')).toBe(0);
  });

  it('pays nothing before each side has made two moves', () => {
    expect(gameXp('win', 3, null)).toBe(0);
    expect(gameXp('win', 4, null)).toBe(30);
  });

  it('pays the daily puzzle with a streak bonus capped at a week', () => {
    expect(puzzleXp(true, false, 1)).toBe(25);
    expect(puzzleXp(true, false, 7)).toBe(55);
    expect(puzzleXp(true, false, 30)).toBe(
      XP_RULES.puzzle.daily +
        XP_RULES.streakBonusPerDay * XP_RULES.streakBonusCap,
    );
  });

  it('pays an archive puzzle less, and halves the XP after a hint', () => {
    expect(puzzleXp(false, false, 0)).toBe(10);
    expect(puzzleXp(false, true, 0)).toBe(5);
    expect(puzzleXp(true, true, 2)).toBe(20);
  });
});
