import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import type { UserPreferences } from '../user-preferences.js';

export class UpdatePreferencesDto implements Partial<UserPreferences> {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['en', 'fr'])
  language?: UserPreferences['language'];

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['light', 'dark', 'system'])
  theme?: UserPreferences['theme'];

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  soundEnabled?: boolean;
}
