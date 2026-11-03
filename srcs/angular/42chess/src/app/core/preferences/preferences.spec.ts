import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../api/api-base-url';
import { AuthSession } from '../auth/auth-session';
import { Preferences, PREFERENCES_KEY } from './preferences';

describe('Preferences', () => {
  beforeEach(() => {
    localStorage.removeItem(PREFERENCES_KEY);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
    localStorage.removeItem(PREFERENCES_KEY);
  });

  it("adopts the account's choices on sign-in, but keeps one made meanwhile", () => {
    const preferences = TestBed.inject(Preferences);
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    TestBed.tick();
    const account = http.expectOne((request) => request.method === 'GET');
    // The player picks a theme before the account answers.
    preferences.setTheme('light');
    http.expectOne((request) => request.method === 'PATCH').flush({});
    account.flush({
      id: 'me',
      username: 'me',
      elo: 1200,
      preferences: { theme: 'dark', soundEnabled: false },
    });
    expect(preferences.theme()).toBe('light');
    expect(preferences.soundEnabled()).toBe(false);
  });
});
