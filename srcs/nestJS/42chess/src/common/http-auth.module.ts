import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HttpAuthGuard } from './http-auth.guard.js';

/** DatabaseModule supplies the shared DataSource used to check account eligibility. */
@Module({
  imports: [ConfigModule, JwtModule.register({})],
  providers: [HttpAuthGuard],
  exports: [HttpAuthGuard],
})
export class HttpAuthModule {}
