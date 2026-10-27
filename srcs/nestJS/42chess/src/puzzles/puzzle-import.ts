import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { DataSource } from 'typeorm';
import { Puzzle } from './puzzles.entity.js';
import type { PuzzleRulesService } from './puzzle-rules.service.js';
import type { PuzzleTheme } from './puzzle.types.js';

/** Lichess exports one record per line. Quoted commas and escaped quotes are accepted. */
export function csvFields(line: string): string[] {
  const fields: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else value += char;
    } else if (char === ',') {
      fields.push(value);
      value = '';
      closed = false;
    } else if (char === '"' && value === '' && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('Malformed CSV quoting');
    else value += char;
  }
  if (quoted) throw new Error('Unterminated CSV field');
  fields.push(value);
  return fields;
}

const themeMap: Record<string, PuzzleTheme> = {
  check: 'CHECK',
  mate: 'CHECKMATE',
  fork: 'FORK',
  pin: 'PIN',
  skewer: 'SKEWER',
  discoveredAttack: 'DISCOVERED_ATTACK',
  mateIn1: 'MATE_IN_ONE',
  mateIn2: 'MATE_IN_TWO',
};

/** Immutable source IDs make reimports safe even after a daily assignment or attempt. */
export async function importPuzzles(
  source: DataSource,
  rules: PuzzleRulesService,
  path: string,
  limit = 1000,
): Promise<{ imported: number; skipped: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error('Import limit must be between 1 and 100000');
  }
  const stream = (await open(path, 'r')).createReadStream();
  const input = createInterface({ input: stream, crlfDelay: Infinity });
  let readError: Error | undefined;
  stream.on('error', (error) => {
    readError = error;
    input.close();
  });
  let headers: string[] | undefined;
  let imported = 0;
  let skipped = 0;
  let lineNumber = 0;
  try {
    for await (const line of input) {
      lineNumber++;
      if (!line.trim()) continue;
      if (line.length > 16384) throw new Error('CSV record is too long');
      const fields = csvFields(line.replace(/^\uFEFF/, ''));
      if (!headers) {
        headers = fields;
        for (const key of [
          'PuzzleId',
          'FEN',
          'Moves',
          'Rating',
          'Themes',
          'GameUrl',
        ]) {
          if (!headers.includes(key))
            throw new Error(`Missing CSV column ${key}`);
        }
        continue;
      }
      if (fields.length !== headers.length)
        throw new Error('CSV column count differs from header');
      const row = Object.fromEntries(
        headers.map((key, index) => [key, fields[index]]),
      );
      if (
        !/^[a-zA-Z0-9]{5}$/.test(row.PuzzleId) ||
        !/^\d{1,5}$/.test(row.Rating) ||
        !/^https:\/\/lichess\.org\/[a-zA-Z0-9/]+(?:#\d+)?$/.test(row.GameUrl)
      ) {
        throw new Error('Invalid Lichess puzzle identity, rating or URL');
      }
      const sourceId = `lichess:${row.PuzzleId}`;
      if (await source.getRepository(Puzzle).existsBy({ sourceId })) {
        skipped++;
      } else {
        const variation = row.Moves.trim().split(/\s+/);
        if (
          variation.length < 2 ||
          variation.length > 64 ||
          variation.length % 2 !== 0 ||
          variation.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
        ) {
          throw new Error('Invalid Lichess setup and solution');
        }
        const initial = await rules.position(row.FEN);
        if (
          initial.status !== 'ongoing' ||
          !initial.legalMoves.includes(variation[0])
        ) {
          throw new Error('Illegal Lichess setup move');
        }
        const start = await rules.position(row.FEN, [variation[0]]);
        const solution = variation.slice(1);
        await rules.validate(start.fen, solution);
        const sourceThemes = row.Themes.split(/\s+/).filter(Boolean);
        const themes = [
          ...new Set(
            sourceThemes.flatMap((tag) =>
              themeMap[tag] ? [themeMap[tag]] : [],
            ),
          ),
        ];
        if (
          themes.some((theme) =>
            ['CHECKMATE', 'MATE_IN_ONE', 'MATE_IN_TWO'].includes(theme),
          )
        ) {
          const end = await rules.position(start.fen, solution);
          if (!end.checkmate || end.winner !== start.turn)
            throw new Error('Mate puzzle does not end in a solver checkmate');
        }
        if (
          (themes.includes('MATE_IN_ONE') && solution.length !== 1) ||
          (themes.includes('MATE_IN_TWO') && solution.length !== 3)
        )
          throw new Error('Invalid mate theme length');
        const result = await source
          .getRepository(Puzzle)
          .createQueryBuilder()
          .insert()
          .values({
            sourceId,
            sourceUrl: row.GameUrl,
            sourceThemes,
            fen: start.fen,
            solution,
            rating: Number(row.Rating),
            themes,
            validatedAt: new Date(),
            solutionMoves: null,
          })
          .onConflict('("sourceId") DO NOTHING')
          .returning('id')
          .execute();
        if (result.raw.length) imported++;
        else skipped++;
      }
      if (imported + skipped >= limit) break;
    }
    if (readError) throw readError;
    if (!headers) throw new Error('Empty puzzle CSV');
    return { imported, skipped };
  } catch (error) {
    throw new Error(
      `Puzzle import failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    input.close();
    stream.destroy();
  }
}
