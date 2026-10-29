export interface UserPreferences {
  language: 'en' | 'fr';
  theme: 'light' | 'dark' | 'system';
  soundEnabled: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = Object.freeze({
  language: 'en',
  theme: 'system',
  soundEnabled: true,
});
