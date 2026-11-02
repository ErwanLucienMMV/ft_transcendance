import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { AuthSession } from './auth-session.entity.js';
import { SessionService } from './session.service.js';
import { AuthGuard } from './auth.guard.js';
import { SessionController } from './session.controller.js';
import { RefreshCookieInterceptor } from './session-cookie.js';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([AuthSession, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256' as const,
          expiresIn: config.getOrThrow<number>('JWT_EXPIRES_IN'),
        },
      }),
    }),
  ],
  controllers: [SessionController],
  providers: [
    SessionService,
    AuthGuard,
    { provide: APP_INTERCEPTOR, useClass: RefreshCookieInterceptor },
  ],
  exports: [SessionService, AuthGuard],
})
export class SessionModule {}
