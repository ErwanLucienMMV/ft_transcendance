import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { GamesModule } from './games/games.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { ChatModule } from './chat/chat.module.js';
import { RatingModule } from './rating/rating.module.js';
import { PuzzlesModule } from './puzzles/puzzles.module.js';
import { BotsModule } from './bots/bots.module.js';

/** Feature modules that must be wired into `AppModule`. Add new ones here. */
const DOMAIN_MODULES = [
  AuthModule,
  UsersModule,
  FriendsModule,
  GamesModule,
  MatchmakingModule,
  ChatModule,
  RatingModule,
  PuzzlesModule,
  BotsModule,
];

describe('AppModule', () => {
  // Reads the `imports` metadata written by @Module() instead of booting the
  // whole app, which would start ObserveModule and its network calls.
  it.each(DOMAIN_MODULES)('imports %o', (domainModule) => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule);

    expect(imports).toContain(domainModule);
  });

  // Fails as soon as a module uses a provider it neither declares nor imports.
  it.each(DOMAIN_MODULES)('compiles %o on its own', async (domainModule) => {
    const moduleRef = await Test.createTestingModule({
      imports: [domainModule],
    }).compile();

    expect(moduleRef.get(domainModule)).toBeInstanceOf(domainModule);
  });
});
