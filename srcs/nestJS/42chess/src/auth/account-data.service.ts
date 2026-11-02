import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { MailClient } from '../mail/mail.client.js';
import { AvatarStorage } from '../users/avatar-storage.js';
import { DEFAULT_PREFERENCES } from '../users/user-preferences.js';
import { DELETED_USERNAME_PREFIX } from '../users/username.rules.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/user.entity.js';
import { AuthService } from './auth.service.js';
import type { DeleteAccountDto } from './dto/delete-account.dto.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

export const EXPORT_FORMAT = '42chess-account-export/1';

type Row = Record<string, unknown>;

/**
 * The owner's rights over their data: a readable copy of everything stored about them, and
 * deletion. A deleted account is anonymized rather than removed, so that the games and rating
 * history of other players keep an opponent; nothing left identifies its owner.
 */
@Injectable()
export class AccountDataService {
  constructor(
    private readonly source: DataSource,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly avatars: AvatarStorage,
    private readonly mail: MailClient,
  ) {}

  async export(userId: string): Promise<Record<string, unknown>> {
    const user = await this.users.findWithSecrets(userId);
    if (!user) throw authRequired();
    const query = (sql: string) =>
      this.source.query(sql, [userId]) as Promise<Row[]>;
    const [
      providers,
      sessions,
      games,
      ratings,
      friends,
      requests,
      messages,
      chat,
      puzzles,
      blocked,
      progress,
      xp,
      achievements,
    ] = await Promise.all([
      query(
        `SELECT provider, "createdAt" AS "linkedAt" FROM oauth_accounts WHERE "userId" = $1 ORDER BY "createdAt"`,
      ),
      query(
        `SELECT "expiresAt", "revokedAt" FROM auth_sessions WHERE "userId" = $1 ORDER BY "expiresAt"`,
      ),
      query(
        `SELECT g.id, g.status, g.result, g."endReason", g.rated, me.color,
                g."initialTime", g.increment, g."initialFen", g."startedAt", g."finishedAt",
                COALESCE(opponent_user.username, 'Computer ' || opponent.color) AS opponent,
                opponent."botDifficulty" AS "opponentBotLevel",
                COALESCE((SELECT json_agg(m.uci ORDER BY m.ply) FROM moves m WHERE m."gameId" = g.id), '[]') AS moves
           FROM game_players me
           JOIN games g ON g.id = me."gameId"
           LEFT JOIN game_players opponent ON opponent."gameId" = g.id AND opponent.id <> me.id
           LEFT JOIN users opponent_user ON opponent_user.id = opponent."userId"
          WHERE me."userId" = $1
          ORDER BY g."createdAt"`,
      ),
      query(
        `SELECT "gameId", "ratingBefore", "ratingAfter", "createdAt" FROM rating_history WHERE "userId" = $1 ORDER BY "createdAt"`,
      ),
      query(
        // A friendship is stored once, with the smaller id first: the user can be on either side.
        `SELECT u.username, f."createdAt" AS since FROM friendships f
           JOIN users u ON u.id = CASE WHEN f."userId" = $1 THEN f."friendId" ELSE f."userId" END
          WHERE f."userId" = $1 OR f."friendId" = $1 ORDER BY f."createdAt"`,
      ),
      query(
        `SELECT CASE WHEN r."senderId" = $1 THEN 'sent' ELSE 'received' END AS direction,
                u.username, r.status, r."createdAt"
           FROM friend_requests r
           JOIN users u ON u.id = CASE WHEN r."senderId" = $1 THEN r."recipientId" ELSE r."senderId" END
          WHERE r."senderId" = $1 OR r."recipientId" = $1
          ORDER BY r."createdAt"`,
      ),
      query(
        `SELECT CASE WHEN m."senderId" = $1 THEN 'sent' ELSE 'received' END AS direction,
                u.username AS "with", m.content, m."createdAt", m."readAt"
           FROM messages m
           JOIN users u ON u.id = CASE WHEN m."senderId" = $1 THEN m."recipientId" ELSE m."senderId" END
          WHERE m."senderId" = $1 OR m."recipientId" = $1
          ORDER BY m."createdAt"`,
      ),
      query(
        `SELECT "gameId", content, "createdAt" FROM game_messages WHERE "userId" = $1 ORDER BY "createdAt"`,
      ),
      query(
        `SELECT "puzzleId", solved, attempts, mistakes, "hintUsed", revealed, duration, "createdAt" FROM puzzle_attempts WHERE "userId" = $1 ORDER BY "createdAt"`,
      ),
      query(
        `SELECT u.username, b."createdAt" AS since FROM user_blocks b JOIN users u ON u.id = b."blockedId" WHERE b."blockerId" = $1 ORDER BY b."createdAt"`,
      ),
      query(
        `SELECT xp, "puzzleStreak", "bestPuzzleStreak", "lastStreakDate"::text AS "lastStreakDate" FROM user_progress WHERE "userId" = $1`,
      ),
      query(
        `SELECT source, "refId", amount, "createdAt" FROM xp_events WHERE "userId" = $1 ORDER BY "createdAt"`,
      ),
      query(
        `SELECT code, "unlockedAt" FROM user_achievements WHERE "userId" = $1 ORDER BY "unlockedAt"`,
      ),
    ]);
    await this.mail.notify(user.email, user.username, 'data-exported');
    return {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        avatarUrl: user.avatarUrl,
        preferences: user.preferences,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
        signIn: {
          password: !!user.passwordHash,
          providers,
          twoFactorEnabledAt: user.twoFactorEnabledAt,
        },
        rating: {
          elo: user.elo,
          gamesPlayed: user.gamesPlayed,
          gamesWon: user.gamesWon,
          gamesDraw: user.gamesDraw,
          gamesLost: user.gamesLost,
        },
      },
      sessions,
      games,
      ratingHistory: ratings,
      friends,
      friendRequests: requests,
      blockedPlayers: blocked,
      privateMessages: messages,
      gameChatMessages: chat,
      puzzleAttempts: puzzles,
      progression: {
        xp: progress[0]?.xp ?? 0,
        puzzleStreak: progress[0]?.puzzleStreak ?? 0,
        bestPuzzleStreak: progress[0]?.bestPuzzleStreak ?? 0,
        lastStreakDate: progress[0]?.lastStreakDate ?? null,
        experience: xp,
        achievements,
      },
    };
  }

  /**
   * Deletes the account after checking the typed username and the password, or the second
   * factor when 2FA is on. An account in a running game must finish it first.
   */
  async delete(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.users.findWithSecrets(userId);
    if (!user) throw authRequired();
    if (dto.confirmation !== user.username)
      throw new BadRequestException({
        statusCode: 400,
        code: 'DELETE_CONFIRMATION_MISMATCH',
        message: 'Type your username exactly to confirm.',
      });
    if (user.passwordHash) {
      if (
        !dto.password ||
        !(await this.passwords.verify(user.passwordHash, dto.password))
      )
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'INVALID_PASSWORD',
          message: 'The password is not correct.',
        });
    }
    if (user.twoFactorEnabledAt) {
      if (!dto.code)
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'INVALID_2FA_CODE',
          message: 'Enter a code from your authenticator app.',
        });
      await this.auth.checkSecondFactor(user, dto.code);
    }
    const { email, username, avatarUrl } = user;
    await this.source.transaction((manager) => this.anonymize(manager, user));
    await this.sessions.revokeAll(user.id);
    await this.avatars.remove(avatarUrl);
    await this.mail.notify(email, username, 'account-deleted');
  }

  private async anonymize(manager: EntityManager, user: User): Promise<void> {
    // Open invitations from or to the account can no longer be played.
    const waiting = `SELECT g.id FROM games g WHERE g.status = 'WAITING' AND (g."invitedOpponentId" = $1
      OR EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id AND p."userId" = $1))`;
    // Locks in the order a join takes them, game then account, so the two never
    // wait on each other: a join already running ends first, and its game counts
    // as active below.
    await manager.query(`${waiting} ORDER BY g.id FOR UPDATE OF g`, [user.id]);
    // The account row is locked next, so a game cannot start while it is deleted.
    await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
      user.id,
    ]);
    const [{ active }] = (await manager.query(
      `SELECT count(*)::int AS active FROM game_players p JOIN games g ON g.id = p."gameId"
        WHERE p."userId" = $1 AND g.status = 'ACTIVE'`,
      [user.id],
    )) as { active: number }[];
    if (active > 0)
      throw new ConflictException({
        statusCode: 409,
        code: 'ACTIVE_GAME_EXISTS',
        message:
          'Finish or resign your current game before deleting the account.',
      });
    await manager.query(
      `DELETE FROM game_messages WHERE "gameId" IN (${waiting})`,
      [user.id],
    );
    await manager.query(`DELETE FROM games WHERE id IN (${waiting})`, [
      user.id,
    ]);
    for (const statement of [
      `DELETE FROM matchmaking_queue WHERE "userId" = $1 AND status = 'WAITING'`,
      `DELETE FROM friendships WHERE "userId" = $1 OR "friendId" = $1`,
      `DELETE FROM friend_requests WHERE "senderId" = $1 OR "recipientId" = $1`,
      `DELETE FROM user_blocks WHERE "blockerId" = $1 OR "blockedId" = $1`,
      `DELETE FROM messages WHERE "senderId" = $1 OR "recipientId" = $1`,
      `DELETE FROM game_messages WHERE "userId" = $1`,
      `DELETE FROM puzzle_attempts WHERE "userId" = $1`,
      `DELETE FROM user_achievements WHERE "userId" = $1`,
      `DELETE FROM xp_events WHERE "userId" = $1`,
      `DELETE FROM user_progress WHERE "userId" = $1`,
      `DELETE FROM oauth_accounts WHERE "userId" = $1`,
      `DELETE FROM oauth_flows WHERE "userId" = $1`,
    ])
      await manager.query(statement, [user.id]);
    await manager.query(
      `UPDATE users SET username = $2, email = NULL, "passwordHash" = NULL, "avatarUrl" = NULL,
              preferences = $3, "emailVerifiedAt" = NULL, "emailVerificationTokenHash" = NULL,
              "emailVerificationExpiresAt" = NULL, "twoFactorSecret" = NULL,
              "twoFactorPendingSecret" = NULL, "twoFactorEnabledAt" = NULL,
              "twoFactorLastTimeStep" = NULL, "twoFactorRecoveryCodes" = NULL,
              "passwordResetTokenHash" = NULL, "passwordResetExpiresAt" = NULL,
              "lastSeenAt" = NULL, "deletedAt" = now(), "updatedAt" = now()
        WHERE id = $1`,
      [
        user.id,
        DELETED_USERNAME_PREFIX + randomBytes(8).toString('hex'),
        JSON.stringify(DEFAULT_PREFERENCES),
      ],
    );
  }
}

function authRequired(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'AUTH_REQUIRED',
    message: 'Authentication is required.',
  });
}
