import { Global, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { HttpMetricsMiddleware } from './http-metrics.middleware.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

@Global()
@Module({
  imports: [PrometheusModule.register()],
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HttpMetricsMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
