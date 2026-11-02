import { Module } from '@nestjs/common';
import { SessionModule } from '../auth/session.module.js';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { HttpAuthGuard } from './http-auth.guard.js';
@Module({
  imports: [SessionModule],
  providers: [AccessTokenGuard, HttpAuthGuard],
  exports: [HttpAuthGuard, AccessTokenGuard, SessionModule],
})
export class HttpAuthModule {}
