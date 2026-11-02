import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';
import { HttpMetricsMiddleware } from './http-metrics.middleware.js';

describe('HTTP duration metrics', () => {
  let metrics: MetricsService;
  let middleware: HttpMetricsMiddleware;

  beforeEach(() => {
    metrics = new MetricsService();
    metrics.registry.clear();
    middleware = new HttpMetricsMiddleware(metrics);
  });

  afterEach(() => metrics.registry.clear());

  function start(path: string, method = 'GET', statusCode = 200) {
    const request = { path, originalUrl: path, method } as Request;
    const response = Object.assign(new EventEmitter(), { statusCode });
    const next = vi.fn();
    middleware.use(request, response as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    return { request, response };
  }

  it('records actual response completion using the late-resolved route template', async () => {
    const clock = vi.spyOn(process.hrtime, 'bigint');
    clock
      .mockReturnValueOnce(1_000_000_000n)
      .mockReturnValueOnce(1_250_000_000n);
    const { request, response } = start('/v1/users/private-id?token=secret');
    expect(await metrics.registry.metrics()).not.toContain('_count{');
    request.route = { path: '/v1/users/:id' };
    response.emit('finish');
    response.emit('finish');
    clock.mockRestore();

    const output = await metrics.registry.metrics();
    expect(output).toContain(
      'http_request_duration_seconds_sum{method="GET",route="/v1/users/:id",status_code="200"} 0.25',
    );
    expect(output).toContain(
      'http_request_duration_seconds_count{method="GET",route="/v1/users/:id",status_code="200"} 1',
    );
    expect(output).toContain('le="0.25"');
    expect(output).not.toMatch(/private-id|secret|token=/);
  });

  it.each([400, 401, 403, 404, 500])(
    'records %i errors after filters have set the final status',
    async (status) => {
      const { response } = start('/unrecognized/private-id');
      response.statusCode = status;
      response.emit('finish');
      expect(await metrics.registry.metrics()).toContain(
        `http_request_duration_seconds_count{method="GET",route="unmatched",status_code="${status}"} 1`,
      );
    },
  );

  it.each(['/metrics', '/metrics/', '/v1/metrics', '/V1/METRICS/'])(
    'excludes the scrape endpoint %s',
    async (path) => {
      const { response } = start(path);
      response.emit('finish');
      expect(await metrics.registry.metrics()).not.toContain('_count{');
    },
  );

  it('bounds unknown method and non-string route labels', async () => {
    const { request, response } = start('/private-id', 'CUSTOM-PRIVATE-ID');
    request.route = { path: ['/private-id'] };
    response.emit('finish');
    expect(await metrics.registry.metrics()).toContain(
      'http_request_duration_seconds_count{method="OTHER",route="unmatched",status_code="200"} 1',
    );
  });
});
