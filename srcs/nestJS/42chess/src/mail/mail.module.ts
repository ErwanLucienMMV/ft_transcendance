import { Module } from '@nestjs/common';
import { MailClient } from './mail.client.js';

/** Client for the forgemail service (emails are never sent from the API). */
@Module({
  providers: [MailClient],
  exports: [MailClient],
})
export class MailModule {}
