import { Module } from '@nestjs/common';
import { PasswordService } from './password.service.js';

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
  providers: [PasswordService],
  exports: [PasswordService],
})
export class AuthModule {}
