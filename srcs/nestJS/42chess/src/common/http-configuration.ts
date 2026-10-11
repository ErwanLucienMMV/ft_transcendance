import type { INestApplication } from '@nestjs/common';

/** Empty CORS_ORIGINS keeps the default Nginx same-origin deployment. */
export function configureHttp(app: INestApplication, allowlist?: string): void {
  const origins = (allowlist ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw new Error(
        'CORS_ORIGINS must contain comma-separated HTTP(S) origins without paths or credentials.',
      );
  }
  app.enableCors({
    origin: origins.length ? origins : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}
