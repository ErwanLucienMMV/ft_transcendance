import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { UUID } from '../../common/types/api.js';

export class TimeControlDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  initialTime: number;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  increment: number;
}

/** Spec §11: client state, actor IDs, color and custom FEN are not accepted here. */
export class CreateGameDto {
  @IsOptional()
  @IsUUID()
  opponentId: UUID | null = null;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TimeControlDto)
  timeControl: TimeControlDto;
}
