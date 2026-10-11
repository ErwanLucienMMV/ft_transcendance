import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { MailModule } from '../mail/mail.module.js';

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
  imports: [UsersModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
  exports: [PasswordService],
})
export class AuthModule {}
