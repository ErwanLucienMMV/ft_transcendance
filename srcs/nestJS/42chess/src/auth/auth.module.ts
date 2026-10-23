import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Environment } from '../config/environment.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';
import { TwoFactorChallengeService } from './two-factor-challenge.service.js';
import { MailModule } from '../mail/mail.module.js';
import { SessionModule } from './session.module.js';

/**
 * Authentication: local accounts (register / login / logout), JWT issuing
 * and validation, and optional Google / GitHub OAuth.
 *
 * OAuth identities are linked to an internal `User`; the rest of the
 * application only deals with `User`, so OAuth can be disabled without
 * breaking anything.
 *
 * Routes: `/auth/*` (see spec §3).
 */
@Module({
  imports: [
    ConfigModule,
    UsersModule,
    MailModule,
    SessionModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TotpService,
    TwoFactorChallengeService,
  ],
  exports: [PasswordService, AuthService],
})
export class AuthModule {}
