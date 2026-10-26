import { Injectable } from '@nestjs/common';
import { ChessEngineService } from '../chess/chess-engine.service.js';
import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import { assertFen } from '../chess/fen.js';
import { puzzleError } from './puzzle-errors.js';

@Injectable()
export class PuzzleRulesService {
  constructor(private readonly engine: ChessEngineService) {}

  async position(fen: string, moves: string[] = []): Promise<ChessSnapshot> {
    try {
      const snapshot = await this.engine.analyze({ fen, moves });
      assertFen(snapshot.fen);
      if (
        !Array.isArray(snapshot.legalMoves) ||
        snapshot.legalMoves.some(
          (move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move),
        ) ||
        !['white', 'black'].includes(snapshot.turn) ||
        typeof snapshot.checkmate !== 'boolean' ||
        ![null, 'white', 'black'].includes(snapshot.winner) ||
        ![
          'ongoing',
          'checkmate',
          'stalemate',
          'insufficient_material',
        ].includes(snapshot.status)
      ) {
        throw new Error('Invalid rules response');
      }
      return snapshot;
    } catch {
      puzzleError(
        503,
        'PUZZLE_ENGINE_UNAVAILABLE',
        'Puzzle rules are temporarily unavailable.',
      );
    }
  }

  /** Import only playable, bounded variations ending with a solver move. */
  async validate(fen: string, moves: string[]): Promise<void> {
    assertFen(fen);
    if (
      !moves.length ||
      moves.length > 63 ||
      moves.length % 2 !== 1 ||
      moves.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
    ) {
      throw new Error('A puzzle needs an odd solution of 1 to 63 UCI plies');
    }
    let before = await this.position(fen);
    const history: string[] = [];
    for (const move of moves) {
      if (before.status !== 'ongoing' || !before.legalMoves.includes(move)) {
        throw new Error(`Illegal puzzle continuation at ply ${history.length}`);
      }
      history.push(move);
      before = await this.position(fen, history);
    }
  }
}
