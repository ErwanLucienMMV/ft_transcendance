import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { IsAllowedTimeControl } from '../time-controls.js';

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
  @IsAllowedTimeControl()
  timeControl: TimeControlDto;

  /** Games against a friend are casual unless both agreed to play for rating. */
  @IsOptional()
  @IsBoolean()
  rated = false;
}
