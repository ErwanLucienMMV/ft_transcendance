import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';

export interface Results {
  played: number;
  won: number;
  drawn: number;
  lost: number;
}
export interface LevelProgress {
  xp: number;
  level: number;
  /** XP at which the current level started, and the next one starts. */
  levelXp: number;
  nextLevelXp: number;
}
export interface PlayerStats {
  /** Null until the player has a rated game. */
  rank: number | null;
  rankedPlayers: number;
  rated: Results;
  casual: Results;
  bots: Results;
  progression: LevelProgress;
  puzzles: { solved: number; streak: number; bestStreak: number; solvedToday: boolean };
}
export interface AchievementProgress {
  code: string;
  name: string;
  description: string;
  goal: number;
  xp: number;
  progress: number;
  unlockedAt: string | null;
}
export interface LeaderboardRow {
  rank: number;
  id: string;
  username: string;
  avatarUrl: string | null;
  elo: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDraw: number;
  gamesLost: number;
  level: number;
}
export interface ProgressionRules {
  xp: {
    game: { win: number; draw: number; loss: number };
    bot: Record<'EASY' | 'MEDIUM' | 'HARD', { win: number; draw: number }>;
    minimumMovesEach: number;
    puzzle: { daily: number; archive: number };
    hintDivisor: number;
    streakBonusPerDay: number;
    streakBonusCap: number;
    maxPuzzleMistakes: number;
  };
  levels: { level: number; xp: number }[];
  achievements: Omit<AchievementProgress, 'progress' | 'unlockedAt'>[];
}

export const LEADERBOARD_PAGE = 25;

/** Share of the current level already earned, from 0 to 1. */
export function levelShare(progress: LevelProgress): number {
  const span = progress.nextLevelXp - progress.levelXp;
  return span > 0 ? Math.min(1, Math.max(0, (progress.xp - progress.levelXp) / span)) : 1;
}

@Injectable({ providedIn: 'root' })
export class ProgressionApi {
  private readonly api = inject(ApiClient);

  leaderboard(
    offset: number,
    limit = LEADERBOARD_PAGE,
  ): Observable<{ total: number; items: LeaderboardRow[] }> {
    return this.api.get('leaderboard', { params: { limit, offset } });
  }

  stats(userId: string): Observable<PlayerStats> {
    return this.api.get(`users/${encodeURIComponent(userId)}/stats`);
  }

  achievements(userId: string): Observable<{ achievements: AchievementProgress[] }> {
    return this.api.get(`users/${encodeURIComponent(userId)}/achievements`);
  }

  rules(): Observable<ProgressionRules> {
    return this.api.get('progression/rules');
  }
}
