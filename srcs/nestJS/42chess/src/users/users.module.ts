import { Module } from '@nestjs/common';

/**
 * User profiles: current user (`/users/me`), public profiles and search.
 *
 * Owns the `users` table and is expected to export a `UsersService` used by
 * `AuthModule`, `FriendsModule`, `GamesModule`, etc.
 *
 * Routes: `/users/*` (see spec §4).
 */
@Module({})
export class UsersModule {}
