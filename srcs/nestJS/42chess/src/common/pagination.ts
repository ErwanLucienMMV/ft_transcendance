import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import type { Pagination } from './types/api.js';

export class PaginationQueryDto implements Pagination {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  offset = 0;
}
