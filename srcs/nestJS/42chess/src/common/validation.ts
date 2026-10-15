import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * Global request validation. Unknown properties are rejected (a client can
 * never send `elo` or `passwordHash`), and errors follow the API contract:
 * `{ statusCode, code, message }`, plus the list of failed rules.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Request body is invalid',
        details: errors.flatMap((error) =>
          Object.values(error.constraints ?? {}),
        ),
      }),
  });
}
