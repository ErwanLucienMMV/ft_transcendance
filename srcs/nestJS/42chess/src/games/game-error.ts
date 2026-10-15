export type GameErrorCode =
  | 'INVALID_GAME_INPUT'
  | 'GAME_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'ALREADY_JOINED'
  | 'GAME_NOT_WAITING'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_ALREADY_FINISHED'
  | 'NOT_A_PLAYER'
  | 'NOT_INVITED'
  | 'WRONG_TURN'
  | 'ILLEGAL_MOVE'
  | 'DRAW_NOT_CLAIMABLE'
  | 'DRAW_ALREADY_OFFERED'
  | 'DRAW_NOT_OFFERED'
  | 'OWN_DRAW_OFFER'
  | 'INVALID_CLOCK_STATE'
  | 'ENGINE_UNAVAILABLE'
  | 'INVALID_ENGINE_RESPONSE'
  | 'INVALID_GAME_HISTORY'
  | 'GAME_BUSY';

/** Domain errors; future authenticated transports map these to their API contract. */
export class GameError extends Error {
  constructor(
    readonly code: GameErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GameError';
  }
}
