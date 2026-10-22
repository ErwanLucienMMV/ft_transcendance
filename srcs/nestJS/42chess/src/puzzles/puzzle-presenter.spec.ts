import {
  toDailyPuzzleResponse,
  toPuzzle,
  toPuzzleAttempt,
} from './puzzle-presenter.js';
import { Puzzle as StoredPuzzle } from './puzzles.entity.js';
import { PuzzleAttempt } from './puzzle-attempts.entity.js';
import { DailyPuzzle } from './daily-puzzles.entity.js';
import { puzzleFixtures } from '../database/seeds/puzzle-fixtures.js';

const ids = {
  whitePuzzle: 'd0000000-0000-4000-8000-000000000005',
  blackPuzzle: 'd0000000-0000-4000-8000-000000000006',
  alice: 'd0000000-0000-4000-8000-000000000001',
  bob: 'd0000000-0000-4000-8000-000000000002',
};
const puzzle = puzzleFixtures(ids)[0];
function row() {
  return Object.assign(new StoredPuzzle(), {
    ...puzzle,
    solution: ['f7g7'],
    solutionMoves: puzzle.solution,
  });
}
describe('spec §30–33 puzzle projections', () => {
  it('maps detailed moves and keeps the UCI engine representation separate', () => {
    expect(toPuzzle(row())).toEqual(puzzle);
    expect(toPuzzle(row()).solution[0].timestamp).toBeInstanceOf(Date);
  });
  it('never serializes either solution representation or author details to the public daily response', () => {
    const daily = Object.assign(new DailyPuzzle(), {
      date: '2026-10-15',
      puzzleId: puzzle.id,
    });
    expect(toDailyPuzzleResponse(daily, row())).toEqual({
      id: puzzle.id,
      date: daily.date,
      fen: puzzle.fen,
      rating: 800,
      themes: ['CHECKMATE', 'MATE_IN_ONE'],
    });
    expect(JSON.stringify(toDailyPuzzleResponse(daily, row()))).not.toMatch(
      /solution|timestamp|playerId|userId/,
    );
    expect(() =>
      toDailyPuzzleResponse(
        Object.assign(new DailyPuzzle(), daily, { puzzleId: 'wrong' }),
        row(),
      ),
    ).toThrow();
  });
  it('refuses to fabricate legacy puzzle details or unknown timing', () => {
    expect(() =>
      toPuzzle(Object.assign(row(), { solutionMoves: null })),
    ).toThrow(/backfill/);
    expect(() => toPuzzle(Object.assign(row(), { themes: null }))).toThrow(
      /backfill/,
    );
    expect(() =>
      toPuzzle(Object.assign(row(), { solution: ['f7f8'] })),
    ).toThrow(/disagree/);
    expect(() =>
      toPuzzleAttempt(
        Object.assign(new PuzzleAttempt(), { attempts: null, duration: null }),
      ),
    ).toThrow(/unknown/);
  });
  it('exposes attempts and duration without conflating failed tries with moves played', () => {
    const attempt = Object.assign(new PuzzleAttempt(), {
      id: ids.alice,
      userId: ids.alice,
      puzzleId: puzzle.id,
      solved: true,
      attempts: 3,
      duration: 1500,
      createdAt: puzzle.createdAt,
      moves: ['f7g7'],
    });
    expect(toPuzzleAttempt(attempt)).toEqual({
      id: ids.alice,
      userId: ids.alice,
      puzzleId: puzzle.id,
      solved: true,
      attempts: 3,
      duration: 1500,
      createdAt: puzzle.createdAt,
    });
  });
});
