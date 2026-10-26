import { Inject, Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Histogram } from 'prom-client';
import { MetricsService } from './metrics.service.js';

const METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  private readonly duration: Histogram<'method' | 'route' | 'status_code'>;

  constructor(@Inject(MetricsService) metrics: MetricsService) {
    this.duration = metrics.histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP response duration in seconds, including error responses.',
      labelNames: ['method', 'route', 'status_code'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });
  }

  use(request: Request, response: Response, next: NextFunction): void {
    // Scrapes must not count themselves or produce recursive scrape traffic.
    if (/^\/(?:v1\/)?metrics\/?$/i.test(request.path)) {
      next();
      return;
    }

    const started = process.hrtime.bigint();
    response.once('finish', () => {
      // Express resolves route only after middleware runs. Never fall back to
      // path/originalUrl/baseUrl: they can contain IDs, tokens, or query strings.
      const route: unknown = request.route?.path;
      this.duration.observe(
        {
          method: METHODS.has(request.method) ? request.method : 'OTHER',
          route:
            typeof route === 'string' && route !== '/{*path}'
              ? route
              : 'unmatched',
          status_code: String(response.statusCode),
        },
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    next();
  }
}
