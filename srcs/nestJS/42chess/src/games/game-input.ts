import { GameError } from './game-error.js';
import { INITIAL_FEN } from './game.entity.js';
import type { CreateGameInput } from './game-state.js';

export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new GameError('INVALID_GAME_INPUT', 'A UUID identifier is required.');
  }
  return value.toLowerCase();
}

export function creationInput(
  input: CreateGameInput,
): Required<CreateGameInput> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'initialTime',
          'increment',
          'color',
          'initialFen',
          'opponentId',
        ].includes(key),
    )
  ) {
    throw new GameError(
      'INVALID_GAME_INPUT',
      'Unexpected game creation parameters.',
    );
  }
  const {
    initialTime,
    increment = 0,
    color = 'WHITE',
    initialFen = INITIAL_FEN,
    opponentId = null,
  } = input;
  if (
    !Number.isInteger(initialTime) ||
    initialTime <= 0 ||
    initialTime > 2147483647 ||
    !Number.isInteger(increment) ||
    increment < 0 ||
    increment > 2147483647 ||
    !['WHITE', 'BLACK'].includes(color) ||
    !isFen(initialFen)
  ) {
    throw new GameError(
      'INVALID_GAME_INPUT',
      'Invalid time control, color or initial FEN.',
    );
  }
  return {
    initialTime,
    increment,
    color,
    initialFen,
    opponentId: opponentId === null ? null : identifier(opponentId),
  };
}

/** Syntax only. Position validity and move legality belong to the C++ engine. */
export function isFen(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(?:[prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+ [wb] (?:-|K?Q?k?q?) (?:-|[a-h][36]) [0-9]+ [1-9][0-9]*$/.test(
      value,
    )
  );
}

export function moveInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value) ||
    value.slice(0, 2) === value.slice(2, 4)
  ) {
    throw new GameError(
      'INVALID_GAME_INPUT',
      'A lowercase UCI move is required.',
    );
  }
  return value;
}
