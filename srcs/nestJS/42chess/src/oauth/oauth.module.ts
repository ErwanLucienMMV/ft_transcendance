import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OAuthFlow } from './oauth-flow.entity.js';
import { OauthAccount } from './oauth-accounts.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { SessionModule } from '../auth/session.module.js';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';
import { OAuthProviders, OAUTH_FETCH } from './oauth-provider.js';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    SessionModule,
    TypeOrmModule.forFeature([OAuthFlow, OauthAccount]),
  ],
  controllers: [OAuthController],
  providers: [
    OAuthService,
    OAuthProviders,
    { provide: OAUTH_FETCH, useValue: fetch },
  ],
})
export class OAuthModule {}
