import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChessEngineService } from './chess/chess-engine.service.js';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsController } from './metrics/metrics.controller.js';
import { ConfigModule } from '@nestjs/config';
import { configurationOptions } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot(configurationOptions),
    DatabaseModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: '42chess',
    }),
    PrometheusModule.register(),
  ],
  controllers: [AppController, MetricsController],
  providers: [AppService, ChessEngineService],
})
export class AppModule {}
