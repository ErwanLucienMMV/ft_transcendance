import { Injectable } from '@nestjs/common';
import { ChessEngineService } from '../chess/chess-engine.service.js';
import type {
  ChessPosition,
  ChessSnapshot,
} from '../chess/chess-engine.service.js';
import { GameError } from './game-error.js';
import type { GameState } from './game-state.js';
import { checkedSnapshot, checkedValidation } from './game-snapshot.js';

@Injectable()
export class GameRulesService {
  constructor(private readonly engine: ChessEngineService) {}

  async analyze(position: ChessPosition): Promise<ChessSnapshot> {
    return checkedSnapshot(
      await this.request(() => this.engine.analyze(position)),
    );
  }

  async move(state: GameState, uci: string): Promise<ChessSnapshot> {
    const position = replayPosition(state, 1);
    const validation = checkedValidation(
      await this.request(() => this.engine.validate(uci, position)),
    );
    if (validation.fen !== state.game.currentFen) {
      throw new GameError(
        'INVALID_GAME_HISTORY',
        'The board disagrees with its replayed history.',
      );
    }
    if (!validation.legal)
      throw new GameError(
        'ILLEGAL_MOVE',
        'The rules engine rejected this move.',
      );
    const snapshot = checkedSnapshot(
      await this.request(() => this.engine.move(uci, position)),
    );
    if (snapshot.turn.toUpperCase() === state.game.turn) {
      throw new GameError(
        'INVALID_ENGINE_RESPONSE',
        'An accepted move must switch the turn.',
      );
    }
    return snapshot;
  }

  async current(state: GameState): Promise<ChessSnapshot> {
    const snapshot = await this.analyze(replayPosition(state));
    if (
      snapshot.fen !== state.game.currentFen ||
      snapshot.turn.toUpperCase() !== state.game.turn
    ) {
      throw new GameError(
        'INVALID_GAME_HISTORY',
        'The board disagrees with its replayed history.',
      );
    }
    return snapshot;
  }

  private async request<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (cause) {
      throw new GameError(
        'ENGINE_UNAVAILABLE',
        'The rules engine could not process this action.',
        { cause },
      );
    }
  }
}

function replayPosition(
  { game, players, moves }: GameState,
  additionalPly = 0,
): ChessPosition {
  const initialColor =
    game.initialFen.split(' ')[1] === 'w' ? 'WHITE' : 'BLACK';
  const opposite = initialColor === 'WHITE' ? 'BLACK' : 'WHITE';
  if (
    players.length !== 2 ||
    moves.some(
      (move, index) =>
        move.ply !== index + 1 ||
        move.color !== (index % 2 === 0 ? initialColor : opposite),
    ) ||
    game.turn !== (moves.length % 2 === 0 ? initialColor : opposite) ||
    game.currentFen !== (moves.at(-1)?.fenAfter ?? game.initialFen)
  ) {
    throw new GameError(
      'INVALID_GAME_HISTORY',
      'Game history is not contiguous or consistent with the board.',
    );
  }
  // Current analysis accepts 2048 plies; a candidate needs one remaining slot.
  if (moves.length + additionalPly > 2048)
    throw new GameError(
      'INVALID_GAME_INPUT',
      'The engine history limit has been reached.',
    );
  return { fen: game.initialFen, moves: moves.map((move) => move.uci) };
}
