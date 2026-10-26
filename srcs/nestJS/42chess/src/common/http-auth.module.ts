import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HttpAuthGuard } from './http-auth.guard.js';

/** DatabaseModule supplies the shared DataSource used to check account eligibility. */
@Module({
  imports: [ConfigModule, JwtModule.register({})],
  providers: [HttpAuthGuard],
  // Nest also instantiates class guards in each controller's module context.
  exports: [HttpAuthGuard, JwtModule, ConfigModule],
})
export class HttpAuthModule {}
