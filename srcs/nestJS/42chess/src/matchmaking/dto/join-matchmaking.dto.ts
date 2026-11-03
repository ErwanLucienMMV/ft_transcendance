import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateNested } from 'class-validator';
import { TimeControlDto } from '../../games/dto/create-game.dto.js';
import { IsAllowedTimeControl } from '../../games/time-controls.js';

/** Actor identity and Elo come from the server, never the request body. */
export class JoinMatchmakingDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TimeControlDto)
  @IsAllowedTimeControl()
  timeControl: TimeControlDto;
}
