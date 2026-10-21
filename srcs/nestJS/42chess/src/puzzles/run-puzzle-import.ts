import source from '../database/data-source.js';
import { ChessEngineService } from '../chess/chess-engine.service.js';
import { PuzzleRulesService } from './puzzle-rules.service.js';
import { importPuzzles } from './puzzle-import.js';

try {
  await source.initialize();
  if (await source.showMigrations())
    throw new Error('Apply pending migrations before importing puzzles');
  const result = await importPuzzles(
    source,
    new PuzzleRulesService(new ChessEngineService()),
    process.argv[2] ?? 'data/puzzles/lichess-starter.csv',
    process.argv[3] === undefined ? 1000 : Number(process.argv[3]),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Puzzle import failed',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
