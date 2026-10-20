import {
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsNotReservedUsername } from '../username.rules.js';

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9_]+$/)
  @IsNotReservedUsername()
  username?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(2048)
  avatarUrl?: string | null;
}
