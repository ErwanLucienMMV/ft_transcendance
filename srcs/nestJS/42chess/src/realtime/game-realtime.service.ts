import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  HttpException,
} from '@nestjs/common';
import { GamesService } from '../games/games.service.js';
import { GamePresenterService } from '../games/game-presenter.service.js';
import { GameError } from '../games/game-error.js';
import { identifier, moveInput } from '../games/game-input.js';
import type { GameState } from '../games/game-state.js';
import type { GameResponse } from '../games/game-api.types.js';
import { RealtimeMessages } from './realtime-messages.js';
import type { RealtimeClient, RealtimeMessage } from './realtime-messages.js';

interface Room {
  clients: Map<string, RealtimeClient>;
  signature: string;
  ended: boolean;
  // Moves already announced to this room with MOVE_PLAYED.
  plies: number;
}
interface GameQueue {
  tail: Promise<void>;
  depth: number;
}
const commands = new Set([
  'JOIN_GAME',
  'SYNC_CLOCK',
  'LEAVE_GAME',
  'MAKE_MOVE',
  'RESIGN',
  'OFFER_DRAW',
  'ACCEPT_DRAW',
  'DECLINE_DRAW',
]);
const promotions: Record<string, string> = {
  QUEEN: 'q',
  ROOK: 'r',
  BISHOP: 'b',
  KNIGHT: 'n',
};

@Injectable()
export class GameRealtimeService
  extends RealtimeMessages
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GameRealtimeService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly memberships = new Map<string, Set<string>>();
  private readonly queues = new Map<string, GameQueue>();
  private interval?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(
    private readonly games: GamesService,
    private readonly presenter: GamePresenterService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.interval = setInterval(() => void this.tick(), 1000);
    this.interval.unref();
  }
  onModuleDestroy(): void {
    clearInterval(this.interval);
    this.rooms.clear();
    this.memberships.clear();
  }

  override async handle(
    client: RealtimeClient,
    message: RealtimeMessage,
  ): Promise<void> {
    if (!commands.has(message.event))
      throw new BadRequestException({
        statusCode: 400,
        code: 'UNKNOWN_EVENT',
        message: 'Unsupported realtime event.',
      });
    const id = identifier(message.data.gameId);
    this.validate(message);
    await this.inGame(id, async () => {
      if (!client.connected()) return;
      if (message.event === 'JOIN_GAME') {
        await this.join(client, id);
        return;
      }
      const room = this.rooms.get(id);
      if (!room?.clients.has(client.connectionId))
        throw new ForbiddenException({
          statusCode: 403,
          code: 'ROOM_REQUIRED',
          message: 'Join the game before sending commands.',
        });
      if (message.event === 'SYNC_CLOCK') {
        const started = performance.now();
        const state = await this.games.settle(id);
        const sampled = performance.now();
        const view = await this.presenter.state(state);
        client.send('CLOCK_SYNC', {
          gameId: id,
          requestId: message.data.requestId,
          processingMs: performance.now() - started,
          sampleAgeMs: performance.now() - sampled,
          ...this.clockSample(state),
          clocks: view.clocks,
          turn: view.board.turn,
          status: view.status,
        });
        return;
      }
      if (message.event === 'LEAVE_GAME') {
        this.leave(client.connectionId, id);
        client.send('GAME_LEFT', { gameId: id });
        return;
      }
      let state: GameState;
      switch (message.event) {
        case 'MAKE_MOVE':
          state = await this.games.play(
            client.userId,
            id,
            this.uci(message.data),
          );
          break;
        case 'RESIGN':
          state = await this.games.resign(client.userId, id);
          break;
        case 'OFFER_DRAW':
          state = await this.games.offerDraw(client.userId, id);
          break;
        case 'ACCEPT_DRAW':
          state = await this.games.acceptDraw(client.userId, id);
          break;
        case 'DECLINE_DRAW':
          state = await this.games.declineDraw(client.userId, id);
          break;
        default:
          throw new BadRequestException('Unsupported command.');
      }
      const view = await this.presenter.state(state);
      this.announce(room, state, view);
      if (message.event === 'OFFER_DRAW' && view.drawOffer) {
        this.broadcast(room, 'DRAW_OFFERED', {
          gameId: id,
          playerId: view.drawOffer.playerId,
        });
      }
      if (message.event === 'DECLINE_DRAW' && view.status !== 'FINISHED') {
        this.broadcast(room, 'DRAW_DECLINED', {
          gameId: id,
          playerId: client.userId,
        });
      }
      this.publish(room, state, view);
    });
  }

  override disconnect(connectionId: string): void {
    for (const id of [...(this.memberships.get(connectionId) ?? [])])
      this.leave(connectionId, id);
  }

  /** Reads durable clocks, including terminal states settled by the existing worker. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await Promise.all(
        [...this.rooms.keys()].map((id) =>
          this.inGame(id, async () => {
            const room = this.rooms.get(id);
            if (!room || room.ended) return;
            const state = await this.games.settle(id);
            const view = await this.presenter.state(state);
            if (this.signature(state) !== room.signature)
              this.publish(room, state, view);
            if (view.status === 'ACTIVE')
              this.broadcast(room, 'CLOCK_UPDATE', {
                gameId: id,
                clocks: view.clocks,
                turn: view.board.turn,
                ...this.clockSample(state),
              });
          }).catch(() => this.logger.warn('Realtime game refresh failed.')),
        ),
      );
    } finally {
      this.ticking = false;
    }
  }

  private async join(client: RealtimeClient, id: string): Promise<void> {
    const memberships =
      this.memberships.get(client.connectionId) ?? new Set<string>();
    if (!memberships.has(id) && memberships.size >= 8)
      throw new HttpException('Too many game subscriptions.', 429);
    let state = await this.games.settle(id);
    if (!state.players.some((player) => player.userId === client.userId)) {
      if (state.game.status !== 'WAITING')
        throw new GameError(
          'NOT_A_PLAYER',
          'Only seated players may subscribe.',
        );
      try {
        state = await this.games.join(client.userId, id);
      } catch (error) {
        // REST and WS can race for the same user's seat. Re-read; never admit an outsider.
        if (
          !(error instanceof GameError) ||
          !['ALREADY_JOINED', 'GAME_NOT_WAITING'].includes(error.code)
        )
          throw error;
        state = await this.games.settle(id);
        if (!state.players.some((player) => player.userId === client.userId))
          throw error;
      }
    }
    if (!client.connected()) return;
    const view = await this.presenter.state(state);
    if (!client.connected()) return;
    const room = this.rooms.get(id) ?? {
      clients: new Map(),
      signature: '',
      ended: false,
      plies: state.moves.length,
    };
    this.rooms.set(id, room);
    room.clients.set(client.connectionId, client);
    memberships.add(id);
    this.memberships.set(client.connectionId, memberships);
    this.publish(room, state, view);
  }

  /**
   * One MOVE_PLAYED per new ply, in order: a bot game commits the human move and the bot reply
   * together, and REST moves reach the room through tick(). Clocks are the current server
   * clocks, because per-ply clocks are not persisted.
   */
  private announce(room: Room, state: GameState, view: GameResponse): void {
    const moves = this.presenter.moves(state).moves;
    for (let index = room.plies; index < moves.length; index++) {
      const last = index === moves.length - 1;
      const board = last ? view.board : this.board(moves[index].fen);
      this.broadcast(room, 'MOVE_PLAYED', {
        gameId: view.id,
        move: moves[index],
        board,
        clocks: view.clocks,
        turn: board.turn,
      });
    }
    room.plies = moves.length;
  }

  private board(fen: string): GameResponse['board'] {
    const [, side, , , halfmoveClock, fullmoveNumber] = fen.split(' ');
    return {
      fen,
      turn: side === 'b' ? 'BLACK' : 'WHITE',
      halfmoveClock: Number(halfmoveClock),
      fullmoveNumber: Number(fullmoveNumber),
    };
  }

  private publish(room: Room, state: GameState, view: GameResponse): void {
    this.announce(room, state, view);
    room.signature = this.signature(state);
    this.broadcast(room, 'GAME_STATE', {
      ...view,
      ...this.clockSample(state),
      gameId: view.id,
      moves: this.presenter.moves(state).moves,
    });
    if (view.status === 'FINISHED' && !room.ended) {
      room.ended = true;
      this.broadcast(room, 'GAME_ENDED', {
        gameId: view.id,
        result: view.result,
      });
    }
  }

  /** Timestamp belongs to the persisted PostgreSQL clock sample, not packet emission. */
  private clockSample(state: GameState) {
    return {
      serverTime: state.game.clock
        ? new Date(state.game.clock.updatedAt).toISOString()
        : null,
      clockStatus: state.game.clock?.status ?? 'WAITING',
    };
  }

  private signature(state: GameState): string {
    return JSON.stringify([
      state.game.status,
      state.game.currentFen,
      state.game.result,
      state.game.endReason,
      state.game.drawOffer,
      state.players.map((p) => p.userId),
      state.moves.length,
    ]);
  }
  private broadcast(room: Room, event: string, data: unknown): void {
    for (const client of room.clients.values())
      if (client.connected()) client.send(event, data);
  }
  private leave(connectionId: string, id: string): void {
    const room = this.rooms.get(id);
    room?.clients.delete(connectionId);
    if (room?.clients.size === 0) this.rooms.delete(id);
    const memberships = this.memberships.get(connectionId);
    memberships?.delete(id);
    if (memberships?.size === 0) this.memberships.delete(connectionId);
  }
  private async inGame(id: string, action: () => Promise<void>): Promise<void> {
    const queue = this.queues.get(id) ?? { tail: Promise.resolve(), depth: 0 };
    if (queue.depth >= 64) throw new HttpException('The game is busy.', 429);
    this.queues.set(id, queue);
    ++queue.depth;
    const task = queue.tail.catch(() => {}).then(action);
    queue.tail = task;
    try {
      await task;
    } finally {
      if (--queue.depth === 0) this.queues.delete(id);
    }
  }
  private validate(message: RealtimeMessage): void {
    const allowed =
      message.event === 'MAKE_MOVE'
        ? ['gameId', 'from', 'to', 'promotion']
        : message.event === 'SYNC_CLOCK'
          ? ['gameId', 'requestId']
          : ['gameId'];
    if (Object.keys(message.data).some((key) => !allowed.includes(key)))
      throw new BadRequestException('Unexpected command fields.');
    if (
      message.event === 'SYNC_CLOCK' &&
      (!Number.isSafeInteger(message.data.requestId) ||
        Number(message.data.requestId) < 0)
    )
      throw new BadRequestException(
        'Expected a non-negative clock request identifier.',
      );
    if (message.event === 'MAKE_MOVE') this.uci(message.data);
  }
  private uci(data: Record<string, unknown>): string {
    if (
      typeof data.from !== 'string' ||
      typeof data.to !== 'string' ||
      !/^[a-h][1-8]$/.test(data.from) ||
      !/^[a-h][1-8]$/.test(data.to) ||
      (data.promotion !== undefined &&
        data.promotion !== null &&
        (typeof data.promotion !== 'string' ||
          !Object.hasOwn(promotions, data.promotion)))
    ) {
      throw new BadRequestException(
        'Expected valid board squares and promotion piece.',
      );
    }
    return moveInput(
      data.from +
        data.to +
        (typeof data.promotion === 'string' ? promotions[data.promotion] : ''),
    );
  }
}
