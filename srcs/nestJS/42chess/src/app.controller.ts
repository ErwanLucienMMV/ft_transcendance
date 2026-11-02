import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import type { ApiDescription } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  describe(): ApiDescription {
    return this.appService.describe();
  }

  @Get('v1/health')
  healthCheck() {
    return {
      status: 'ok',
    };
  }
}
