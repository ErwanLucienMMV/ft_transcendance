import { Controller, Get, Header } from '@nestjs/common';
import { register } from 'prom-client';

@Controller('v1/metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', register.contentType)
  async getMetrics() {
    return register.metrics();
  }
}