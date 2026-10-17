import { HttpException } from '@nestjs/common';
import { GameError } from '../games/game-error.js';
import type { GameErrorCode } from '../games/game-error.js';
import type { ApiErrorResponse } from './types/api.js';

const gameStatus: Record<GameErrorCode, number> = {
  INVALID_GAME_INPUT: 400,
  GAME_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  ALREADY_JOINED: 409,
  GAME_NOT_WAITING: 409,
  GAME_NOT_ACTIVE: 409,
  GAME_ALREADY_FINISHED: 409,
  NOT_A_PLAYER: 403,
  NOT_INVITED: 403,
  WRONG_TURN: 409,
  ILLEGAL_MOVE: 400,
  DRAW_NOT_CLAIMABLE: 409,
  DRAW_ALREADY_OFFERED: 409,
  DRAW_NOT_OFFERED: 409,
  OWN_DRAW_OFFER: 403,
  INVALID_CLOCK_STATE: 500,
  ENGINE_UNAVAILABLE: 503,
  INVALID_ENGINE_RESPONSE: 502,
  INVALID_GAME_HISTORY: 500,
  GAME_BUSY: 409,
  BOT_UNAVAILABLE: 503,
  INVALID_BOT_RESPONSE: 502,
};
const httpCodes: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

export function apiError(exception: unknown): ApiErrorResponse {
  if (exception instanceof GameError) {
    const statusCode = gameStatus[exception.code];
    const code =
      exception.code === 'WRONG_TURN'
        ? 'NOT_YOUR_TURN'
        : exception.code === 'ILLEGAL_MOVE'
          ? 'INVALID_MOVE'
          : exception.code;
    return {
      statusCode,
      code,
      message:
        statusCode >= 500
          ? 'The game service is temporarily unavailable.'
          : exception.message,
    };
  }
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const body =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};
    const code =
      typeof body.code === 'string'
        ? body.code
        : (httpCodes[statusCode] ?? 'HTTP_ERROR');
    const message =
      typeof body.message === 'string'
        ? body.message
        : typeof response === 'string'
          ? response
          : exception.message;
    const details =
      Array.isArray(body.details) &&
      body.details.every((value) => typeof value === 'string')
        ? (body.details as string[])
        : undefined;
    return { statusCode, code, message, ...(details ? { details } : {}) };
  }
  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An internal server error occurred.',
  };
}
