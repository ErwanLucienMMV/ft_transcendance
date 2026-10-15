import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureHttp } from '../dist/common/http-configuration.js';

@Controller('cors-fixture')
class CorsFixture {
  @Get() get() {
    return { status: 'ok' };
  }
}

describe('Configured CORS origins', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CorsFixture],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, 'https://play.example, http://localhost:4200');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it.each(['https://play.example', 'http://localhost:4200'])(
    'allows the configured origin %s',
    async (origin) => {
      await request(app.getHttpServer())
        .options('/cors-fixture')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type')
        .expect(204)
        .expect('Access-Control-Allow-Origin', origin)
        .expect('Access-Control-Allow-Headers', /authorization/i);
    },
  );
  it('does not allow arbitrary origins while keeping same-origin requests usable', async () => {
    const response = await request(app.getHttpServer())
      .get('/cors-fixture')
      .set('Origin', 'https://attacker.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await request(app.getHttpServer())
      .get('/cors-fixture')
      .expect(200)
      .expect({ status: 'ok' });
  });
  it.each([
    '*',
    'null',
    'https://play.example/path',
    'ftp://play.example',
    'https://user:password@play.example',
  ])('rejects malformed allowlist %s at startup', (value) => {
    expect(() => configureHttp(app, value)).toThrow();
  });
});
