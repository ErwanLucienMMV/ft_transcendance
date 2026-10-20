import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';

export class SearchUsersDto extends PaginationQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 32)
  q: string;
}
