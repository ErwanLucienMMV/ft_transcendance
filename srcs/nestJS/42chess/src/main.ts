import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './config/environment.js';
import { configureHttp } from './common/http-configuration.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.enableShutdownHooks();
  const config = app.get(ConfigService<Environment, true>);
  configureHttp(app, config.get('CORS_ORIGINS', { infer: true }));
  await app.listen(config.get('APIPORT', { infer: true }));
}
await bootstrap();
