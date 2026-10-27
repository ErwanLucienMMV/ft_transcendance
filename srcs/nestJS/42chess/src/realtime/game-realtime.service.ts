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
import { SpectatorRegistry } from '../games/spectator-registry.js';
import { RealtimeMessages } from './realtime-messages.js';
import type { RealtimeClient, RealtimeMessage } from './realtime-messages.js';

interface Room {
  clients: Map<string, RealtimeClient>;
  // Connections watching without a seat: they receive everything and may send nothing.
  spectators: Set<string>;
  spectatorCount: number;
  // Last GAME_STATE, resent when only the spectator count changes.
  snapshot: Record<string, unknown> | null;
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
  'LEAVE_GAME',
  'MAKE_MOVE',
  'RESIGN',
  'OFFER_DRAW',
  'ACCEPT_DRAW',
  'DECLINE_DRAW',
  'START_SPECTATING',
  'STOP_SPECTATING',
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
    private readonly spectators: SpectatorRegistry,
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
      if (message.event === 'START_SPECTATING') {
        await this.spectate(client, id);
        return;
      }
      const room = this.rooms.get(id);
      if (!room?.clients.has(client.connectionId))
        throw new ForbiddenException({
          statusCode: 403,
          code: 'ROOM_REQUIRED',
          message: 'Join the game before sending commands.',
        });
      const spectating = room.spectators.has(client.connectionId);
      if (
        message.event === 'LEAVE_GAME' ||
        (message.event === 'STOP_SPECTATING' && spectating)
      ) {
        this.leave(client.connectionId, id);
        client.send('GAME_LEFT', { gameId: id });
        return;
      }
      if (spectating || message.event === 'STOP_SPECTATING')
        throw new ForbiddenException({
          statusCode: 403,
          code: spectating ? 'SPECTATOR_READ_ONLY' : 'NOT_SPECTATING',
          message: spectating
            ? 'Spectators cannot act on the game.'
            : 'This connection is not spectating the game.',
        });
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
                serverTime: new Date().toISOString(),
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
    const room = this.room(id, state);
    room.clients.set(client.connectionId, client);
    room.spectators.delete(client.connectionId);
    memberships.add(id);
    this.memberships.set(client.connectionId, memberships);
    this.count(room, id);
    this.publish(room, state, view);
  }

  /**
   * Read-only subscription for any signed-in user (spec §28). Every game but a WAITING one
   * is visible: there are no private games, and a finished game sends its state and end.
   */
  private async spectate(client: RealtimeClient, id: string): Promise<void> {
    const memberships =
      this.memberships.get(client.connectionId) ?? new Set<string>();
    if (!memberships.has(id) && memberships.size >= 8)
      throw new HttpException('Too many game subscriptions.', 429);
    const state = await this.games.settle(id);
    if (state.game.status === 'WAITING')
      throw new GameError('GAME_NOT_ACTIVE', 'This game has not started yet.');
    if (!client.connected()) return;
    const view = await this.presenter.state(state);
    if (!client.connected()) return;
    const room = this.room(id, state);
    // A seated connection keeps its seat; spectating never downgrades it.
    if (!room.clients.has(client.connectionId))
      room.spectators.add(client.connectionId);
    room.clients.set(client.connectionId, client);
    memberships.add(id);
    this.memberships.set(client.connectionId, memberships);
    const ended = room.ended;
    if (!room.snapshot || this.signature(state) !== room.signature) {
      this.count(room, id);
      this.publish(room, state, view);
    } else if (this.count(room, id)) {
      this.broadcast(room, 'GAME_STATE', room.snapshot);
    } else {
      // Nothing changed for the others: only the newcomer needs the state.
      client.send('GAME_STATE', room.snapshot);
    }
    // publish() announces the end once per room; a late spectator still needs it.
    if (ended) client.send('GAME_ENDED', { gameId: id, result: view.result });
  }

  private room(id: string, state: GameState): Room {
    const room = this.rooms.get(id) ?? {
      clients: new Map(),
      spectators: new Set<string>(),
      spectatorCount: 0,
      snapshot: null,
      signature: '',
      ended: false,
      plies: state.moves.length,
    };
    this.rooms.set(id, room);
    return room;
  }

  /** Recounts distinct watching users; true when the number changed. */
  private count(room: Room, id: string): boolean {
    const users = new Set(
      [...room.spectators].map(
        (connection) => room.clients.get(connection)?.userId,
      ),
    );
    users.delete(undefined);
    if (users.size === room.spectatorCount) return false;
    room.spectatorCount = users.size;
    this.spectators.set(id, users.size);
    if (room.snapshot)
      room.snapshot = { ...room.snapshot, spectatorCount: users.size };
    return true;
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
    room.snapshot = {
      ...view,
      gameId: view.id,
      moves: this.presenter.moves(state).moves,
      spectatorCount: room.spectatorCount,
    };
    this.broadcast(room, 'GAME_STATE', room.snapshot);
    if (view.status === 'FINISHED' && !room.ended) {
      room.ended = true;
      this.broadcast(room, 'GAME_ENDED', {
        gameId: view.id,
        result: view.result,
      });
    }
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
    if (room?.spectators.delete(connectionId) && this.count(room, id))
      this.broadcast(room, 'GAME_STATE', room.snapshot);
    if (room?.clients.size === 0) {
      this.rooms.delete(id);
      this.spectators.set(id, 0);
    }
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
        : ['gameId'];
    if (Object.keys(message.data).some((key) => !allowed.includes(key)))
      throw new BadRequestException('Unexpected command fields.');
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
