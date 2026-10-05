import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface ChessPosition {
  /** Initial FEN; omit for the standard starting position. */
  fen?: string;
  /** Ordered UCI moves from that position, required for repetition detection. */
  moves?: string[];
}
export interface ChessSnapshot {
  fen: string;
  turn: 'white' | 'black';
  check: boolean;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  status: 'ongoing' | 'checkmate' | 'stalemate' | 'insufficient_material';
  winner: 'white' | 'black' | null;
  repetitionCount: number;
  threefoldClaimable: boolean;
  fiftyMoveClaimable: boolean;
  legalMoves: string[];
}

/** Internal backend client. Node 22 supplies the native WebSocket implementation. */
@Injectable()
export class ChessEngineService {
  analyze(position: ChessPosition = {}): Promise<ChessSnapshot> {
    return this.request({ ...position, op: 'analyze' });
  }

  validate(move: string, position: ChessPosition = {}): Promise<{ legal: boolean; fen: string }> {
    return this.request({ ...position, op: 'validate', move });
  }

  move(move: string, position: ChessPosition = {}): Promise<ChessSnapshot> {
    return this.request({ ...position, op: 'move', move });
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    // One socket per request: no shared game/session state, safe for simultaneous games.
    // Open lazily so NestJS can start even if the engine is still starting.
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const socket = new WebSocket(process.env.CHESS_ENGINE_URL ?? 'ws://127.0.0.1:8081');
      let settled = false;
      const finish = (error?: Error, result?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
        if (error) reject(error);
        else resolve(result as T);
      };
      const timer = setTimeout(() => finish(new Error('Chess engine request timed out')), 10_000);
      socket.addEventListener('open', () => {
        if (settled) return;
        try { socket.send(JSON.stringify({ ...payload, id })); }
        catch { finish(new Error('Could not send chess engine request')); }
      });
      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data !== 'string') throw new Error('Expected text response');
          const response = JSON.parse(event.data) as {
            id?: string; ok?: boolean; result?: T; error?: { message?: string };
          };
          if (response.id !== id || typeof response.ok !== 'boolean') {
            throw new Error('Invalid chess engine response');
          }
          if (!response.ok) finish(new Error(response.error?.message ?? 'Chess engine rejected request'));
          else if (response.result === undefined) throw new Error('Missing chess engine result');
          else finish(undefined, response.result);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Invalid chess engine response'));
        }
      });
      socket.addEventListener('error', () => finish(new Error('Chess engine connection failed')));
      socket.addEventListener('close', () => finish(new Error('Chess engine closed before responding')));
    });
  }
}
