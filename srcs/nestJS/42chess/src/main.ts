import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './config/environment.js';
import { configureHttp } from './common/http-configuration.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Nginx (a private address of the Docker network) adds the client address
  // to X-Forwarded-For: rate limits and logs then see the real client.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.enableShutdownHooks();
  const config = app.get(ConfigService<Environment, true>);
  configureHttp(app, config.get('CORS_ORIGINS', { infer: true }));
  await app.listen(config.get('APIPORT', { infer: true }));
}
await bootstrap();
