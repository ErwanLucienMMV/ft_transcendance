import { Module } from '@nestjs/common';
import { BotEngine } from './bot-engine.js';
import { NativeBotAdapter } from './native-bot.adapter.js';
@Module({
	providers: [{ provide: BotEngine, useClass: NativeBotAdapter }],
	exports: [BotEngine],
})
export class BotEngineModule {}
