import { HttpException } from '@nestjs/common';

export function puzzleError(
  status: number,
  code: string,
  message: string,
): never {
  throw new HttpException({ statusCode: status, code, message }, status);
}
