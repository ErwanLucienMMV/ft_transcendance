import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Puzzle } from '../dist/puzzles/puzzles.entity.js';
import { PuzzlesService } from '../dist/puzzles/puzzles.service.js';
import { PuzzleRulesService } from '../dist/puzzles/puzzle-rules.service.js';
import { importPuzzles } from '../dist/puzzles/puzzle-import.js';
import { createPuzzleFixture } from './puzzle.fixture.js';

describe('Puzzle training with PostgreSQL and the C++ rules daemon', () => {
  let f: Awaited<ReturnType<typeof createPuzzleFixture>>;
  beforeAll(async () => {
    f = await createPuzzleFixture();
  });
  beforeEach(async () => {
    await f.clear();
  });
  afterAll(async () => {
    await f?.close();
  });

  it('imports legal Lichess positions after setup, preserving provenance and ratings', async () => {
    expect(await f.load()).toEqual({ imported: 4, skipped: 0 });
    const puzzle = await f.reference();
    const setup = await f.engine.analyze({
      fen: 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17',
      moves: ['e8d7'],
    });
    expect(puzzle.fen).toBe(setup.fen);
    expect(puzzle).toMatchObject({
      rating: 1760,
      themes: ['CHECKMATE', 'MATE_IN_TWO'],
    });
    expect(puzzle.sourceUrl).toMatch(/^https:\/\/lichess.org/);
    expect(puzzle.sourceThemes).toContain('middlegame');
    expect(puzzle.solution).toBeUndefined();
    expect(puzzle.solutionMoves).toBeUndefined();
  });

  it('reimports idempotently without mutating puzzles already in use', async () => {
    await f.load();
    const daily = await f.service.daily();
    const attempt = await f.service.start(f.alice, daily.id);
    expect(await f.load()).toEqual({ imported: 0, skipped: 4 });
    expect(await f.service.daily()).toEqual(daily);
    expect(await f.service.state(f.alice, attempt.attemptId)).toEqual(attempt);
  });

  it('imports the bundled 128-puzzle starter catalogue and validates every variation', async () => {
    expect(
      await importPuzzles(
        f.source,
        f.rules,
        'data/puzzles/lichess-starter.csv',
      ),
    ).toEqual({ imported: 128, skipped: 0 });
  }, 60000);

  it('reports a missing input file without an unhandled stream error', async () => {
    await expect(
      importPuzzles(
        f.source,
        f.rules,
        `/tmp/missing-puzzle-${randomUUID()}.csv`,
      ),
    ).rejects.toThrow(/ENOENT/);
  });

  it('honours bounded import limits', async () => {
    expect(
      await importPuzzles(
        f.source,
        f.rules,
        'data/puzzles/lichess-sample.csv',
        2,
      ),
    ).toEqual({ imported: 2, skipped: 0 });
    await expect(importPuzzles(f.source, f.rules, 'unused', 0)).rejects.toThrow(
      /limit/,
    );
  });

  it('reports a malformed or illegal row without activating it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'puzzle-import-'));
    try {
      await expect(importPuzzles(f.source, f.rules, directory)).rejects.toThrow(
        /EISDIR/,
      );
      const path = join(directory, 'invalid.csv');
      await writeFile(
        path,
        'PuzzleId,FEN,Moves,Rating,Themes,GameUrl\nABCDE,7k/5Q2/6K1/8/8/8/8/8 w - - 0 1,f7f8 h8h7,800,mate,https://lichess.org/example\n',
      );
      await expect(importPuzzles(f.source, f.rules, path)).rejects.toThrow(
        /line 2/,
      );
      expect(await f.source.getRepository(Puzzle).count()).toBe(0);
      await writeFile(path, 'PuzzleId,FEN\n');
      await expect(importPuzzles(f.source, f.rules, path)).rejects.toThrow(
        /Missing CSV column/,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('returns 503 for an empty or entirely unvalidated catalogue', async () => {
    await expect(f.service.daily()).rejects.toMatchObject({
      response: { code: 'PUZZLE_CATALOG_EMPTY' },
    });
    await f.source.getRepository(Puzzle).save({
      fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
      solution: ['f7g7'],
      themes: [],
      rating: 800,
    });
    await expect(f.service.daily()).rejects.toMatchObject({
      response: { code: 'PUZZLE_CATALOG_EMPTY' },
    });
  });

  it('gives concurrent API replicas exactly one persisted puzzle for the UTC day', async () => {
    await f.load();
    const other = new PuzzlesService(f.source, f.rules);
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? other : f.service).daily(),
      ),
    );
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(
      1,
    );
    const [{ date }] = await f.source.query(
      `SELECT (now() AT TIME ZONE 'UTC')::date::text AS date`,
    );
    expect(results[0].date).toBe(date);
    expect(await f.source.query('SELECT id FROM daily_puzzles')).toHaveLength(
      1,
    );
    expect(Object.keys(results[0]).sort()).toEqual([
      'date',
      'fen',
      'id',
      'rating',
      'themes',
    ]);
  });

  it('rotates through unused puzzles before reusing the least recent one', async () => {
    await f.load();
    const rows = await f.source
      .getRepository(Puzzle)
      .find({ order: { id: 'ASC' } });
    for (let index = 0; index < rows.length - 1; index++) {
      await f.source.query(
        `INSERT INTO daily_puzzles ("puzzleId", date) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - $2::int)`,
        [rows[index].id, index + 1],
      );
    }
    expect((await f.service.daily()).id).toBe(rows.at(-1)!.id);
  });

  it('uses the oldest assignment once every puzzle has appeared', async () => {
    await f.load();
    const rows = await f.source
      .getRepository(Puzzle)
      .find({ order: { id: 'ASC' } });
    for (let index = 0; index < rows.length; index++) {
      await f.source.query(
        `INSERT INTO daily_puzzles ("puzzleId", date) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - $2::int)`,
        [rows[index].id, index + 1],
      );
    }
    const daily = await f.service.daily();
    expect(daily.id).toBe(rows.at(-1)!.id);
    expect(await f.source.query('SELECT id FROM daily_puzzles')).toHaveLength(
      rows.length + 1,
    );
  });

  it('rolls back and reapplies training fields without losing existing puzzle rows', async () => {
    await f.load();
    const puzzle = await f.reference();
    await f.source.undoLastMigration();
    expect(
      await f.source.query('SELECT fen FROM puzzles WHERE id=$1', [puzzle.id]),
    ).toEqual([{ fen: puzzle.fen }]);
    expect(await f.source.runMigrations()).toHaveLength(1);
    const [row] = await f.source.query(
      'SELECT "validatedAt", "sourceId" FROM puzzles WHERE id=$1',
      [puzzle.id],
    );
    expect(row).toEqual({ validatedAt: null, sourceId: null });
    await expect(f.service.daily()).rejects.toMatchObject({
      response: { code: 'PUZZLE_CATALOG_EMPTY' },
    });
  });

  it('keeps today stable when importing more puzzles', async () => {
    await importPuzzles(
      f.source,
      f.rules,
      'data/puzzles/lichess-sample.csv',
      1,
    );
    const daily = await f.service.daily();
    await f.load();
    expect(await f.service.daily()).toEqual(daily);
  });

  it('persists progress, automatically answers, and resumes after service recreation', async () => {
    await f.load();
    const puzzle = await f.reference();
    const start = await f.service.start(f.alice, puzzle.id);
    const turn = await f.service.play(f.alice, start.attemptId, 'a2e6', 0);
    expect(turn).toMatchObject({
      correct: true,
      completed: false,
      ply: 2,
      version: 1,
      attempts: 1,
      opponentMove: 'd7d8',
    });
    const resumed = await new PuzzlesService(f.source, f.rules).state(
      f.alice,
      start.attemptId,
    );
    expect(resumed.fen).toBe(turn.nextPosition);
    const completed = await f.service.play(
      f.alice,
      start.attemptId,
      'f7f8',
      resumed.version,
    );
    expect(completed).toMatchObject({
      correct: true,
      completed: true,
      ply: 3,
      version: 2,
      attempts: 2,
    });
    expect((await f.engine.analyze({ fen: completed.fen })).checkmate).toBe(
      true,
    );
    const [stored] = await f.source.query(
      'SELECT * FROM puzzle_attempts WHERE id=$1',
      [start.attemptId],
    );
    expect(stored.moves).toEqual(['a2e6', 'd7d8', 'f7f8']);
    expect(stored.solved).toBe(true);
    expect(stored.duration).toBeGreaterThan(0);
    await expect(
      f.service.play(f.alice, start.attemptId, 'f7f8', 2),
    ).rejects.toMatchObject({ response: { code: 'PUZZLE_ALREADY_COMPLETED' } });
  });

  it.each(['a2a3', 'a1a8'])(
    'counts wrong/illegal move %s without changing the position or progress',
    async (move) => {
      await f.load();
      const start = await f.service.start(f.alice, (await f.reference()).id);
      const response = await f.service.play(f.alice, start.attemptId, move, 0);
      expect(response).toMatchObject({
        correct: false,
        completed: false,
        fen: start.fen,
        ply: 0,
        attempts: 1,
        version: 1,
      });
      expect(response.opponentMove).toBeUndefined();
      await expect(
        f.service.play(f.alice, start.attemptId, 'a2e6', 0),
      ).rejects.toMatchObject({ response: { code: 'PUZZLE_STALE_VERSION' } });
      expect(
        (await f.service.play(f.alice, start.attemptId, 'a2e6', 1)).correct,
      ).toBe(true);
    },
  );

  it('accepts another legal mate-in-one, as required by the Lichess format', async () => {
    const puzzle = await f.composed(
      '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
      ['f7g7'],
      ['MATE_IN_ONE', 'CHECKMATE'],
    );
    const start = await f.service.start(f.alice, puzzle.id);
    expect(
      await f.service.play(f.alice, start.attemptId, 'f7h7', 0),
    ).toMatchObject({ correct: true, completed: true });
  });

  it.each([
    ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q'], 'a7a8q'],
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', ['e5d6'], 'e5d6'],
    ['4k3/8/8/8/8/8/8/4K2R w K - 0 1', ['e1g1'], 'e1g1'],
    ['8/8/8/8/8/6k1/5q2/7K b - - 0 1', ['f2g2'], 'f2g2'],
  ] as [string, string[], string][])(
    'delegates special moves and black-to-play to the rules engine: %s',
    async (fen, line, move) => {
      const puzzle = await f.composed(fen, line);
      const start = await f.service.start(f.alice, puzzle.id);
      expect(
        await f.service.play(f.alice, start.attemptId, move, 0),
      ).toMatchObject({ correct: true, completed: true });
    },
  );

  it('commits only one of two simultaneous moves from the same version', async () => {
    await f.load();
    const start = await f.service.start(f.alice, (await f.reference()).id);
    const results = await Promise.allSettled([
      f.service.play(f.alice, start.attemptId, 'a2e6', 0),
      new PuzzlesService(f.source, f.rules).play(
        f.alice,
        start.attemptId,
        'a2e6',
        0,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await f.service.state(f.alice, start.attemptId)).toMatchObject({
      ply: 2,
      version: 1,
      attempts: 1,
    });
  });

  it('isolates users and allows a fresh attempt after a previous attempt', async () => {
    await f.load();
    const puzzle = await f.reference();
    const first = await f.service.start(f.alice, puzzle.id);
    const second = await f.service.start(f.alice, puzzle.id);
    expect(second.attemptId).not.toBe(first.attemptId);
    for (const operation of [
      () => f.service.state(f.bob, first.attemptId),
      () => f.service.play(f.bob, first.attemptId, 'a2e6', 0),
      () => f.service.start(f.alice, randomUUID()),
      () => f.service.start(randomUUID(), puzzle.id),
    ])
      await expect(operation()).rejects.toMatchObject({ status: 404 });
    expect(await f.service.state(f.alice, first.attemptId)).toMatchObject({
      version: 0,
    });
  });

  it('leaves the attempt untouched if the external engine is unavailable', async () => {
    await f.load();
    const start = await f.service.start(f.alice, (await f.reference()).id);
    const unavailable = new PuzzleRulesService({
      analyze: async () => {
        throw new Error('offline');
      },
    } as never);
    await expect(
      new PuzzlesService(f.source, unavailable).play(
        f.alice,
        start.attemptId,
        'a2e6',
        0,
      ),
    ).rejects.toMatchObject({
      response: { code: 'PUZZLE_ENGINE_UNAVAILABLE' },
    });
    expect(await f.service.state(f.alice, start.attemptId)).toEqual(start);
  });

  it('does not hold a transaction or connection while waiting for the rules service', async () => {
    await f.load();
    const start = await f.service.start(f.alice, (await f.reference()).id);
    const spy = vi
      .spyOn(f.rules, 'position')
      .mockImplementationOnce(async (fen, moves) => {
        const [{ count }] = await f.source.query(
          `SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = $1 AND state = 'idle in transaction'`,
          [f.schema],
        );
        expect(count).toBe(0);
        return f.engine.analyze({ fen, moves });
      });
    try {
      await f.service.play(f.alice, start.attemptId, 'a2e6', 0);
    } finally {
      spy.mockRestore();
    }
  });
});
