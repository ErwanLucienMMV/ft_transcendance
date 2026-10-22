// Contract excerpts from Proposition spec.md §8, §12, §24, §26, §31–33.
// Compile with npm run test:contracts; independent of the entity storage shape.
type UUID = string;
type Square = string;
type ChessColor = 'WHITE' | 'BLACK';
type PieceType = 'PAWN' | 'KNIGHT' | 'BISHOP' | 'ROOK' | 'QUEEN' | 'KING';
type PuzzleTheme =
  | 'CHECK'
  | 'CHECKMATE'
  | 'FORK'
  | 'PIN'
  | 'SKEWER'
  | 'DISCOVERED_ATTACK'
  | 'MATE_IN_ONE'
  | 'MATE_IN_TWO';
interface TimeControl {
  initialTime: number;

  increment: number;
}
interface ChessMove {
  from: Square;

  to: Square;

  promotion?: PieceType;

  notation: string;

  timestamp: Date;

  playerId: UUID;
}
interface MatchmakingEntry {
  id: UUID;

  userId: UUID;

  timeControl: TimeControl;

  elo: number;

  joinedAt: Date;

  status: 'WAITING' | 'MATCHED' | 'CANCELLED';
}
interface RatingChange {
  id: UUID;

  userId: UUID;

  gameId: UUID;

  ratingBefore: number;

  ratingAfter: number;

  change: number;

  createdAt: Date;
}
interface Puzzle {
  id: UUID;

  fen: string;

  solution: ChessMove[];

  rating: number;

  themes: PuzzleTheme[];

  createdAt: Date;
}
interface DailyPuzzle {
  date: string;

  puzzleId: UUID;
}
interface PuzzleAttempt {
  id: UUID;

  userId: UUID;

  puzzleId: UUID;

  solved: boolean;

  attempts: number;

  duration: number;

  createdAt: Date;
}

import type {
  toPuzzle,
  toPuzzleAttempt,
  toDailyPuzzleResponse,
} from '../src/puzzles/puzzle-presenter.js';
import type { toMatchmakingEntry } from '../src/matchmaking/matchmaking.types.js';
import type { toRatingChange } from '../src/rating/rating.types.js';
import type {
  toPrivateMessage,
  toGameMessage,
} from '../src/messages/message-presenter.js';
import type { DailyPuzzle as StoredDaily } from '../src/puzzles/daily-puzzles.entity.js';
import type {
  ApiErrorResponse,
  CreateGameResponse,
} from '../src/common/types/api.js';
// The actual type must provide every specified field with the specified type.
type Assignable<Expected, Actual extends Expected> = Actual;
export type SpecContractChecks = [
  Assignable<ChessColor, import('../src/common/types/chess.js').ChessColor>,
  Assignable<MatchmakingEntry, ReturnType<typeof toMatchmakingEntry>>,
  Assignable<RatingChange, ReturnType<typeof toRatingChange>>,
  Assignable<Puzzle, ReturnType<typeof toPuzzle>>,
  Assignable<ChessMove[], ReturnType<typeof toPuzzle>['solution']>,
  Assignable<DailyPuzzle, StoredDaily>,
  Assignable<PuzzleAttempt, ReturnType<typeof toPuzzleAttempt>>,
  Assignable<
    {
      id: UUID;
      date: string;
      rating: number;
      fen: string;
      themes: PuzzleTheme[];
    },
    ReturnType<typeof toDailyPuzzleResponse>
  >,
  Assignable<
    {
      id: UUID;
      senderId: UUID;
      receiverId: UUID;
      content: string;
      createdAt: string;
    },
    ReturnType<typeof toPrivateMessage>
  >,
  Assignable<
    {
      id: UUID;
      gameId: UUID;
      sender: { id: UUID; username: string };
      content: string;
      createdAt: string;
    },
    ReturnType<typeof toGameMessage>
  >,
  Assignable<
    { statusCode: number; code: string; message: string },
    ApiErrorResponse
  >,
  Assignable<{ gameId: UUID; status: 'WAITING' }, CreateGameResponse>,
];
