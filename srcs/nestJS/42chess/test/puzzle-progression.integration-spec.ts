import { Puzzle } from '../dist/puzzles/puzzles.entity.js';
import { PuzzlesService } from '../dist/puzzles/puzzles.service.js';
import { ProgressionService } from '../dist/progression/progression.service.js';
import { createPuzzleFixture } from './puzzle.fixture.js';

const TODAY = `(now() AT TIME ZONE 'UTC')::date`;

// Attempt limits, hints, revealed solutions, the archive, and what a puzzle earns.
describe('Puzzle limits, archive and rewards', () => {
  let f: Awaited<ReturnType<typeof createPuzzleFixture>>;
  let progression: ProgressionService;
  let service: PuzzlesService;
  beforeAll(async () => {
    f = await createPuzzleFixture();
    progression = new ProgressionService(f.source);
    service = new PuzzlesService(f.source, f.rules, progression);
  });
  beforeEach(async () => {
    await f.source.query(
      'TRUNCATE user_achievements, xp_events, user_progress',
    );
    await f.clear();
    await f.load();
  });
  afterAll(async () => {
    await f?.close();
  });

  async function solution(puzzleId: string): Promise<string[]> {
    const [row] = (await f.source.query(
      'SELECT solution FROM puzzles WHERE id = $1',
      [puzzleId],
    )) as { solution: string[] }[];
    return row.solution;
  }

  async function solve(userId: string, attemptId: string, line: string[]) {
    let turn;
    for (let ply = 0, version = 0; ply < line.length; ply += 2, version++)
      turn = await service.play(userId, attemptId, line[ply], version);
    return turn!;
  }

  it('refuses a puzzle that has not been published yet', async () => {
    const daily = await service.daily();
    const [other] = await f.source
      .getRepository(Puzzle)
      .createQueryBuilder('p')
      .where('p.id <> :id', { id: daily.id })
      .getMany();
    for (const operation of [
      () => service.start(f.alice, other.id),
      () => service.published(other.id),
    ])
      await expect(operation()).rejects.toMatchObject({
        status: 404,
        response: { code: 'PUZZLE_NOT_FOUND' },
      });
    // Tomorrow's puzzle is not playable today either.
    await f.source.query(
      `INSERT INTO daily_puzzles (date, "puzzleId") VALUES (${TODAY} + 1, $1)`,
      [other.id],
    );
    await expect(service.start(f.alice, other.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await service.published(daily.id)).toEqual(daily);
  });

  it('ends an attempt at the third mistake', async () => {
    const puzzle = await f.reference();
    const start = await service.start(f.alice, puzzle.id);
    expect(start).toMatchObject({
      mistakes: 0,
      mistakesLeft: 3,
      failed: false,
      practice: false,
    });
    let turn;
    for (let version = 0; version < 3; version++)
      turn = await service.play(f.alice, start.attemptId, 'a1a8', version);
    expect(turn).toMatchObject({
      correct: false,
      mistakes: 3,
      mistakesLeft: 0,
      failed: true,
      completed: false,
    });
    await expect(
      service.play(f.alice, start.attemptId, 'a2e6', 3),
    ).rejects.toMatchObject({ response: { code: 'PUZZLE_ATTEMPT_FAILED' } });
    await expect(service.hint(f.alice, start.attemptId)).rejects.toMatchObject({
      response: { code: 'PUZZLE_ATTEMPT_FAILED' },
    });
    // The spec route leaves the failed attempt and starts a practice one.
    const again = await service.move(f.alice, puzzle.id, 'a2e6');
    expect(again.attemptId).not.toBe(start.attemptId);
    expect(again).toMatchObject({ correct: true, practice: true });
  });

  it('rewards the daily puzzle solved on the only attempt and extends the streak', async () => {
    const daily = await service.daily();
    await f.source.query(
      `INSERT INTO user_progress ("userId", "puzzleStreak", "bestPuzzleStreak", "lastStreakDate")
       VALUES ($1, 2, 2, ${TODAY} - 1)`,
      [f.alice],
    );
    const start = await service.start(f.alice, daily.id);
    const done = await solve(
      f.alice,
      start.attemptId,
      await solution(daily.id),
    );
    // 20 for the daily puzzle and 5 per day of a three-day streak.
    expect(done).toMatchObject({
      completed: true,
      reward: { xp: 35, streak: 3 },
    });
    const stats = await progression.stats(f.alice);
    expect(stats.puzzles).toEqual({
      solved: 1,
      streak: 3,
      bestStreak: 3,
      solvedToday: true,
    });
    // Then 10 for "Puzzle solver" and 20 for "On a roll".
    expect(stats.progression.xp).toBe(65);
    const { achievements } = await progression.progress(f.alice);
    expect(
      achievements.filter((item) => item.unlockedAt).map((item) => item.code),
    ).toEqual(['PUZZLE_FIRST', 'STREAK_3']);

    // A second attempt is practice: solving it again earns nothing.
    const practice = await service.start(f.alice, daily.id);
    expect(practice.practice).toBe(true);
    const repeat = await solve(
      f.alice,
      practice.attemptId,
      await solution(daily.id),
    );
    expect(repeat.reward).toBeUndefined();
    expect((await progression.stats(f.alice)).progression.xp).toBe(65);
    expect(await service.progress(f.alice, daily.id)).toMatchObject({
      attempt: { attemptId: practice.attemptId, completed: true },
      rewarded: true,
    });
  });

  it('starts the streak again after a missed day', async () => {
    const daily = await service.daily();
    await f.source.query(
      `INSERT INTO user_progress ("userId", "puzzleStreak", "bestPuzzleStreak", "lastStreakDate")
       VALUES ($1, 5, 6, ${TODAY} - 2)`,
      [f.alice],
    );
    expect((await progression.stats(f.alice)).puzzles.streak).toBe(0);
    const start = await service.start(f.alice, daily.id);
    const done = await solve(
      f.alice,
      start.attemptId,
      await solution(daily.id),
    );
    expect(done.reward).toEqual({ xp: 25, streak: 1 });
    expect((await progression.stats(f.alice)).puzzles).toMatchObject({
      streak: 1,
      bestStreak: 6,
    });
  });

  it('halves the XP after a hint, and an earlier day earns no streak', async () => {
    const puzzle = await f.reference();
    const start = await service.start(f.alice, puzzle.id);
    const hinted = await service.hint(f.alice, start.attemptId);
    expect(hinted).toMatchObject({ hint: 'a2', hintUsed: true });
    expect(hinted).not.toHaveProperty('solution');
    const done = await solve(
      f.alice,
      start.attemptId,
      await solution(puzzle.id),
    );
    expect(done.reward).toEqual({ xp: 5, streak: null });
    expect((await progression.stats(f.alice)).puzzles.streak).toBe(0);
  });

  it('shows the solution and ends the attempt unsolved', async () => {
    const puzzle = await f.reference();
    const start = await service.start(f.bob, puzzle.id);
    const shown = await service.solution(f.bob, start.attemptId);
    expect(shown).toMatchObject({
      revealed: true,
      failed: true,
      solution: await solution(puzzle.id),
    });
    await expect(
      service.play(f.bob, start.attemptId, 'a2e6', 0),
    ).rejects.toMatchObject({ response: { code: 'PUZZLE_ATTEMPT_FAILED' } });
    expect((await progression.stats(f.bob)).progression.xp).toBe(0);
  });

  it('lists earlier days in the archive with how the player did', async () => {
    // Earlier days first: today's puzzle then goes to a puzzle never shown,
    // so it cannot be one of these two.
    const puzzle = await f.reference();
    const failed = await f.composed(
      '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
      ['f7g7'],
      ['MATE_IN_ONE'],
    );
    const daily = await service.daily();
    const attempt = await service.start(f.alice, puzzle.id);
    await solve(f.alice, attempt.attemptId, await solution(puzzle.id));
    const other = await service.start(f.alice, failed.id);
    await service.solution(f.alice, other.attemptId);
    const archive = await service.archive(f.alice, { limit: 10, offset: 0 });
    expect(archive.total).toBe(2);
    expect(archive.items.map((item) => item.id)).not.toContain(daily.id);
    expect(
      Object.fromEntries(archive.items.map((item) => [item.id, item.status])),
    ).toEqual({ [puzzle.id]: 'SOLVED', [failed.id]: 'FAILED' });
    // Newest first.
    expect(archive.items[0].date > archive.items[1].date).toBe(true);
    const fresh = await service.archive(f.bob, { limit: 1, offset: 1 });
    expect(fresh).toMatchObject({ total: 2, items: [{ status: null }] });
  });

  it('serializes a second attempt with the solve of the first', async () => {
    const puzzle = await f.reference();
    const line = await solution(puzzle.id);
    const start = await service.start(f.alice, puzzle.id);
    // Up to the last move, then the last move and a new attempt at the same time.
    let version = 0;
    for (let ply = 0; ply < line.length - 1; ply += 2)
      await service.play(f.alice, start.attemptId, line[ply], version++);
    const [last, second] = await Promise.all([
      service.play(f.alice, start.attemptId, line.at(-1)!, version),
      service.start(f.alice, puzzle.id),
    ]);
    const rewarded = Boolean(last.reward);
    // Either the solve came first (and earned) or the new attempt did (and it did not).
    expect((await progression.stats(f.alice)).progression.xp > 0).toBe(
      rewarded,
    );
    expect(second.practice).toBe(true);
  });
});
