import { Message } from './messages.entity.js';
import { GameMessage } from './game-messages.entity.js';
import { toPrivateMessage, toGameMessage } from './message-presenter.js';
import { RatingHistory } from '../rating/rating-history.entity.js';
import {
  toRatingChange,
  toRatingHistoryResponse,
} from '../rating/rating.types.js';
import { MatchmakingEntry } from '../matchmaking/matchmaking-queue.entity.js';
import { toMatchmakingEntry } from '../matchmaking/matchmaking.types.js';

describe('spec public projections', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z');
  it('maps recipient to receiver and excludes read state, relations and other internal fields', () => {
    const row = Object.assign(new Message(), {
      id: 'message',
      senderId: 'alice',
      recipientId: 'bob',
      content: 'hello',
      createdAt,
      readAt: null,
    });
    expect(toPrivateMessage(row)).toEqual({
      id: 'message',
      senderId: 'alice',
      receiverId: 'bob',
      content: 'hello',
      createdAt: createdAt.toISOString(),
    });
  });
  it('projects only the public game-message sender and rejects a mismatched author', () => {
    const row = Object.assign(new GameMessage(), {
      id: 'message',
      gameId: 'game',
      userId: 'alice',
      content: 'hello',
      createdAt,
    });
    const user = { id: 'alice', username: 'Alice', passwordHash: 'secret' };
    expect(toGameMessage(row, user)).toEqual({
      id: 'message',
      gameId: 'game',
      sender: { id: 'alice', username: 'Alice' },
      content: 'hello',
      createdAt: createdAt.toISOString(),
    });
    expect(() => toGameMessage(row, { id: 'bob', username: 'Bob' })).toThrow();
  });
  it.each([
    [1200, 1210, 10],
    [1200, 1190, -10],
    [1200, 1200, 0],
  ])(
    'derives the signed rating change %i -> %i',
    (ratingBefore, ratingAfter, change) => {
      const row = Object.assign(new RatingHistory(), {
        id: 'rating',
        gameId: 'game',
        userId: 'alice',
        ratingBefore,
        ratingAfter,
        createdAt,
      });
      expect(toRatingChange(row).change).toBe(change);
      expect(toRatingHistoryResponse([row])).toEqual({
        history: [
          {
            gameId: 'game',
            ratingBefore,
            ratingAfter,
            change,
            createdAt: createdAt.toISOString(),
          },
        ],
      });
    },
  );
  it('maps queue storage to all required spec fields', () => {
    const row = Object.assign(new MatchmakingEntry(), {
      id: 'queue',
      userId: 'alice',
      initialTime: 600000,
      increment: 2000,
      rating: 1200,
      createdAt,
      status: 'WAITING' as const,
    });
    expect(toMatchmakingEntry(row)).toEqual({
      id: 'queue',
      userId: 'alice',
      timeControl: { initialTime: 600000, increment: 2000 },
      elo: 1200,
      joinedAt: createdAt,
      status: 'WAITING',
    });
  });
});
