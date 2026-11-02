import { Module } from '@nestjs/common';
import { BotEngine } from './bot-engine.js';
import { BotPacer } from './bot-think-time.js';
import { NativeBotAdapter } from './native-bot.adapter.js';
@Module({
  providers: [{ provide: BotEngine, useClass: NativeBotAdapter }, BotPacer],
  exports: [BotEngine, BotPacer],
})
export class BotEngineModule {}
