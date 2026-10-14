import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { apiError } from './api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = apiError(exception);
    if (response.statusCode >= 500 && !(exception instanceof HttpException))
      this.logger.error(
        'Unhandled API error',
        exception instanceof Error ? exception.stack : String(exception),
      );
    const { httpAdapter } = this.adapterHost;
    const context = host.switchToHttp();
    if (!httpAdapter.isHeadersSent(context.getResponse()))
      httpAdapter.reply(context.getResponse(), response, response.statusCode);
  }
}
