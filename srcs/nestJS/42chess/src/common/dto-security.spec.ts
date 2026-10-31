import type { Type } from '@nestjs/common';
import { LoginDto } from '../auth/dto/login.dto.js';
import { RegisterDto } from '../auth/dto/register.dto.js';
import { ResendVerificationDto } from '../auth/dto/resend-verification.dto.js';
import { VerifyEmailDto } from '../auth/dto/verify-email.dto.js';
import { VerifyTwoFactorDto } from '../auth/dto/verify-two-factor.dto.js';
import { BotGameMoveDto, CreateBotGameDto } from '../bots/bots.controller.js';
import { SendFriendRequestDto } from '../friends/dto/send-friend-request.dto.js';
import { CreateGameDto, TimeControlDto } from '../games/dto/create-game.dto.js';
import { moveInput } from '../games/game-input.js';
import { JoinMatchmakingDto } from '../matchmaking/dto/join-matchmaking.dto.js';
import { PuzzleMoveDto } from '../puzzles/dto/puzzle-move.dto.js';
import { SearchUsersDto } from '../users/dto/search-users.dto.js';
import { UpdatePreferencesDto } from '../users/dto/update-preferences.dto.js';
import { UpdateProfileDto } from '../users/dto/update-profile.dto.js';
import { PaginationQueryDto } from './pagination.js';
import { createValidationPipe } from './validation.js';

const timeControl = { initialTime: 300000, increment: 2000 };
const uuid = '00000000-0000-4000-8000-000000000001';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature';
const cases: [
  Type<object>,
  Record<string, unknown>,
  Record<string, unknown>,
][] = [
  [
    RegisterDto,
    {
      username: 'secure_player',
      email: 'player@example.org',
      password: 'test-password',
    },
    { username: '../invalid', email: 'no-email', password: 'short' },
  ],
  [
    LoginDto,
    { login: 'player', password: 'test-password' },
    { login: [], password: {} },
  ],
  [
    ResendVerificationDto,
    { email: 'player@example.org' },
    { email: 'invalid' },
  ],
  [VerifyEmailDto, { token: 'a'.repeat(43) }, { token: ['a'.repeat(43)] }],
  [
    VerifyTwoFactorDto,
    { challengeToken: jwt, code: '123456' },
    { challengeToken: 'invalid', code: 123456 },
  ],
  [TimeControlDto, timeControl, { initialTime: 0, increment: -1 }],
  [
    CreateGameDto,
    { timeControl },
    { timeControl: { initialTime: '300000', increment: 0 } },
  ],
  [
    CreateBotGameDto,
    { difficulty: 'EASY', timeControl },
    { difficulty: 'IMPOSSIBLE', timeControl },
  ],
  [BotGameMoveDto, { uci: 'e2e4' }, {}],
  [SendFriendRequestDto, { recipientId: uuid }, { recipientId: 'invalid' }],
  [JoinMatchmakingDto, { timeControl }, { timeControl: [] }],
  [PuzzleMoveDto, { move: 'e2e4', version: 0 }, { move: 'e2e9', version: -1 }],
  [
    PaginationQueryDto,
    { limit: '20', offset: '0' },
    { limit: 101, offset: -1 },
  ],
  [SearchUsersDto, { q: 'player' }, { q: {}, limit: 101 }],
  [
    UpdatePreferencesDto,
    { theme: 'dark', soundEnabled: true },
    { theme: 'invalid', soundEnabled: 'true' },
  ],
  [
    UpdateProfileDto,
    { preferences: { language: 'fr' } },
    { preferences: { language: 'invalid' } },
  ],
];

describe('SEC-02 / SEC-07 global DTO boundary', () => {
  const pipe = createValidationPipe();
  describe.each(cases)('%s', (metatype, valid, invalid) => {
    const metadata = { type: 'body' as const, metatype };
    it('accepts its documented input', async () => {
      await expect(pipe.transform(valid, metadata)).resolves.toBeInstanceOf(
        metatype,
      );
    });
    it('rejects invalid required fields, types or bounds', async () => {
      await expect(pipe.transform(invalid, metadata)).rejects.toMatchObject({
        response: { statusCode: 400, code: 'VALIDATION_ERROR' },
      });
    });
    it.each(['userId', 'senderId', 'elo', 'passwordHash', 'emailVerifiedAt'])(
      'rejects server-owned field %s',
      async (field) => {
        await expect(
          pipe.transform({ ...valid, [field]: 'forged' }, metadata),
        ).rejects.toMatchObject({
          response: { statusCode: 400, code: 'VALIDATION_ERROR' },
        });
      },
    );
  });

  it.each([CreateGameDto, CreateBotGameDto, JoinMatchmakingDto])(
    'rejects state injected into nested time controls in %s',
    async (metatype) => {
      await expect(
        pipe.transform(
          {
            ...(metatype === CreateBotGameDto ? { difficulty: 'EASY' } : {}),
            timeControl: { ...timeControl, elo: 9999 },
          },
          { type: 'body', metatype },
        ),
      ).rejects.toThrow();
    },
  );
  it('rejects privileged fields inside otherwise valid preferences', async () => {
    await expect(
      pipe.transform(
        { preferences: { language: 'fr', elo: 9999 } },
        { type: 'body', metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow();
  });
  // BotGameMoveDto requires presence; the controller's domain parser validates
  // the value before calling GamesService. Cover both layers explicitly.
  it.each([null, 12, {}, [], 'e2e9', 'e2e2', 'e7e8k', 'e2e4;DROP TABLE users'])(
    'rejects malformed bot UCI at the domain boundary: %j',
    (uci) => {
      expect(() => moveInput(uci)).toThrow();
    },
  );
});
