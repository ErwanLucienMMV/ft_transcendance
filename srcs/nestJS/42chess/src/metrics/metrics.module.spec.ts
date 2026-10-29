import 'reflect-metadata';
import { Controller, Get, Param, UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsModule } from './metrics.module.js';
import { MetricsService } from './metrics.service.js';

@Controller('v1/metrics-test')
class ProbeController {
  @Get('items/:id')
  item(@Param('id') id: string) {
    return { id };
  }

  @Get('protected')
  protected() {
    throw new UnauthorizedException();
  }
}

describe('MetricsModule HTTP integration', () => {
  let app: INestApplication;
  let metrics: MetricsService;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [MetricsModule],
      controllers: [ProbeController],
    }).compile();
    app = fixture.createNestApplication();
    metrics = app.get(MetricsService);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    metrics?.registry.clear();
  });

  it('exposes global route, error, and 404 observations on both existing scrape URLs', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/v1/metrics-test/items/secret-id?token=private')
      .expect(200);
    await request(server).get('/v1/metrics-test/items/another-id').expect(200);
    await request(server).get('/v1/metrics-test/protected').expect(401);
    await request(server).get('/missing/private-id').expect(404);
    const scrape = await request(server)
      .get('/metrics?extra=private')
      .expect(200);
    expect(scrape.headers['content-type']).toContain('text/plain');
    expect(scrape.text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/v1/metrics-test/items/:id",status_code="200"} 2',
    );
    expect(scrape.text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/v1/metrics-test/protected",status_code="401"} 1',
    );
    expect(scrape.text).toContain(
      'http_request_duration_seconds_count{method="GET",route="unmatched",status_code="404"} 1',
    );
    expect(scrape.text).not.toMatch(
      /secret-id|another-id|private-id|token=|route="\/metrics"/,
    );

    const alternate = await request(server).get('/v1/metrics/').expect(200);
    expect(alternate.text).toContain('http_request_duration_seconds_count');
    expect(alternate.text).not.toMatch(/route="\/v1\/metrics\/?"/);
  });
});
