import { Controller, HttpCode, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import {
  AUTH_RATE_LIMIT,
  rateLimitEnabled,
  rateLimitOptions,
} from './rate-limit.js';

@Controller('limited')
class LimitedFixture {
  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  attempt() {
    return { ok: true };
  }
}

describe('rate limiting', () => {
  describe('rateLimitEnabled', () => {
    it('is on by default outside the test runner', () => {
      expect(rateLimitEnabled({})).toBe(true);
    });

    it('is off by default under the test runner', () => {
      expect(rateLimitEnabled({ VITEST: 'true' })).toBe(false);
    });

    it.each(['false', '0', 'off', 'NO'])(
      'can be turned off with %s',
      (value) => {
        expect(rateLimitEnabled({ RATE_LIMIT_ENABLED: value })).toBe(false);
      },
    );

    it('can be turned on explicitly, even under the test runner', () => {
      expect(
        rateLimitEnabled({ VITEST: 'true', RATE_LIMIT_ENABLED: 'true' }),
      ).toBe(true);
    });
  });

  it('keeps sign-in attempts strict', () => {
    expect(AUTH_RATE_LIMIT.default.limit).toBeLessThanOrEqual(20);
  });

  describe('guard', () => {
    let app: INestApplication<App>;
    const previous = process.env['RATE_LIMIT_ENABLED'];

    beforeAll(async () => {
      process.env['RATE_LIMIT_ENABLED'] = 'true';
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot(rateLimitOptions)],
        controllers: [LimitedFixture],
        providers: [
          { provide: APP_GUARD, useClass: ThrottlerGuard },
          { provide: APP_FILTER, useClass: ApiExceptionFilter },
        ],
      }).compile();
      app = module.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      if (previous === undefined) delete process.env['RATE_LIMIT_ENABLED'];
      else process.env['RATE_LIMIT_ENABLED'] = previous;
      await app?.close();
    });

    it('answers 429 with the API error format once the limit is reached', async () => {
      const server = app.getHttpServer();
      await request(server).post('/limited').expect(200);
      await request(server).post('/limited').expect(200);
      const response = await request(server).post('/limited').expect(429);
      expect(response.body).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
      });
    });
  });
});
