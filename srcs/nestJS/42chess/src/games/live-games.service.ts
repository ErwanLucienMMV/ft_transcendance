import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import type { LiveGamesResponse } from './game-api.types.js';
import { playerRef } from './player-ref.js';
import { SpectatorRegistry } from './spectator-registry.js';

/** How many games the live list shows; the most recently started come first. */
export const LIVE_GAMES_LIMIT = 50;

@Injectable()
export class LiveGamesService {
  constructor(
    private readonly source: DataSource,
    private readonly spectators: SpectatorRegistry,
  ) {}

  async list(): Promise<LiveGamesResponse> {
    const games = await this.source.getRepository(Game).find({
      where: { status: 'ACTIVE' },
      order: { startedAt: 'DESC', id: 'DESC' },
      take: LIVE_GAMES_LIMIT,
    });
    if (games.length === 0) return { games: [] };
    const seats = await this.source.getRepository(GamePlayer).find({
      where: { gameId: In(games.map((game) => game.id)) },
      relations: { user: true },
    });
    const seat = (id: string, color: GamePlayer['color']) => {
      const found = seats.find((s) => s.gameId === id && s.color === color);
      return found ? playerRef(found) : null;
    };
    return {
      games: games.map((game) => ({
        id: game.id,
        whitePlayer: seat(game.id, 'WHITE'),
        blackPlayer: seat(game.id, 'BLACK'),
        spectatorCount: this.spectators.count(game.id),
        timeControl: {
          initialTime: game.initialTime,
          increment: game.increment,
        },
        startedAt: game.startedAt!.toISOString(),
      })),
    };
  }
}
