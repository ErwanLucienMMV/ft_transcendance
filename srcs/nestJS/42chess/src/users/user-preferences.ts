export interface UserPreferences {
  language: 'en' | 'fr';
  theme: 'light' | 'dark' | 'system';
  soundEnabled: boolean;
  /** Only friends may send this player private messages and challenges. */
  messagesFromFriendsOnly: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = Object.freeze({
  language: 'en',
  theme: 'system',
  soundEnabled: true,
  messagesFromFriendsOnly: false,
});
