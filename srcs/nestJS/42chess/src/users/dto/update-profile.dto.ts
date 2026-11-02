import {
  IsString,
  IsObject,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsNotReservedUsername } from '../username.rules.js';
import { Type } from 'class-transformer';
import { UpdatePreferencesDto } from './update-preferences.dto.js';

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => UpdatePreferencesDto)
  preferences?: UpdatePreferencesDto;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9_]+$/)
  @IsNotReservedUsername()
  username?: string;

  // No avatarUrl: an avatar is uploaded (POST /v1/users/me/avatar), never an arbitrary URL that
  // every viewer's browser would then fetch.
}
