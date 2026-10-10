import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

/**
 * User profiles: current user (`/users/me`), public profiles and search.
 *
 * Owns the `users` table and is expected to export a `UsersService` used by
 * `AuthModule`, `FriendsModule`, `GamesModule`, etc.
 *
 * Routes: `/users/*` (see spec §4).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
