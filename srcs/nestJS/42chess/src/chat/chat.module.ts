import { Module } from '@nestjs/common';

/**
 * In-game chat and private messages between users, delivered over
 * WebSocket and persisted in PostgreSQL.
 *
 * Routes: `/conversations/*` (see spec §21–§22).
 */
@Module({})
export class ChatModule {}
