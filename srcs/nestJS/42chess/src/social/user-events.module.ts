import { Module } from '@nestjs/common';
import { UserEvents } from './user-events.js';

/** The per-user socket registry alone, for modules that only push events. */
@Module({
  providers: [UserEvents],
  exports: [UserEvents],
})
export class UserEventsModule {}
