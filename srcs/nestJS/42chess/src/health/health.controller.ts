import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import type { HealthReport } from './health.types.js';

@Controller('v1/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Public: Docker's health check, the status page and anyone curious. Answers
   * 503 only when the database is unreachable, since nothing works without it.
   */
  @Get()
  async report(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthReport> {
    const report = await this.health.report();
    if (report.status === 'down')
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    response.setHeader('Cache-Control', 'no-store');
    return report;
  }
}
