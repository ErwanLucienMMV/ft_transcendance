import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { AuthSession } from '../../core/auth/auth-session';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { Preferences } from '../../core/preferences/preferences';
import { Sounds } from '../../core/sound/sounds';
import { downloadName } from './account-api';
import { AppearanceSettings } from './appearance-settings';
import { DataSettings } from './data-settings';
import { PrivacySettings } from './privacy-settings';
import { avatarProblem, ProfileSettings } from './profile-settings';
import { SecuritySettings } from './security-settings';

const user = { id: 'user-1', username: 'alice', elo: 1200, avatarUrl: null };
const accessToken = `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`;
const own = (changes: object = {}) => ({
  ...user,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesDraw: 0,
  gamesLost: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...changes,
});

describe('Account settings', () => {
  let http: HttpTestingController, session: AuthSession;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor, authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(AuthSession);
    session.establish({ accessToken, user });
  });
  afterEach(() => {
    http.verify();
    session.clear();
  });

  function type(element: HTMLElement, selector: string, value: string) {
    const input = element.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  function button(element: HTMLElement, text: string) {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === text,
    )!;
  }

  describe('appearance', () => {
    it('saves the theme and sound to the account, the move options to this device', async () => {
      const play = vi.spyOn(TestBed.inject(Sounds), 'play').mockImplementation(() => {});
      const fixture = TestBed.createComponent(AppearanceSettings);
      await fixture.whenStable();
      http
        .expectOne('/api/v1/users/me')
        .flush(own({ preferences: { theme: 'dark', soundEnabled: false, language: 'en' } }));
      await fixture.whenStable();
      const element: HTMLElement = fixture.nativeElement;
      const preferences = TestBed.inject(Preferences);
      expect(element.querySelector('[data-value="dark"]')?.getAttribute('aria-checked')).toBe(
        'true',
      );
      const sound = element.querySelector<HTMLInputElement>('[data-setting="sound"]')!;
      expect(sound.checked).toBe(false);

      (element.querySelector('[data-value="light"]') as HTMLButtonElement).click();
      const theme = http.expectOne('/api/v1/users/me');
      expect(theme.request.method).toBe('PATCH');
      expect(theme.request.body).toEqual({ preferences: { theme: 'light' } });
      theme.flush(own());
      await fixture.whenStable();
      expect(document.documentElement.dataset['theme']).toBe('light');

      sound.click();
      const soundRequest = http.expectOne('/api/v1/users/me');
      expect(soundRequest.request.body).toEqual({ preferences: { soundEnabled: true } });
      soundRequest.flush(own());
      expect(play).toHaveBeenCalledWith('move');

      element.querySelector<HTMLInputElement>('[data-setting="confirm-moves"]')!.click();
      element.querySelector<HTMLInputElement>('[data-setting="premoves"]')!.click();
      expect(preferences.confirmMoves()).toBe(true);
      expect(preferences.premoves()).toBe(false);
      preferences.setConfirmMoves(false);
      preferences.setPremoves(true);
      preferences.setTheme('system');
      http.match('/api/v1/users/me').forEach((request) => request.flush(own()));
    });
  });

  describe('profile', () => {
    it('checks a picture before sending it', () => {
      expect(avatarProblem({ type: 'image/png', size: 1000 })).toBeNull();
      expect(avatarProblem({ type: 'image/gif', size: 1000 })).toContain('PNG, JPEG or WebP');
      expect(avatarProblem({ type: 'image/svg+xml', size: 10 })).not.toBeNull();
      expect(avatarProblem({ type: 'image/webp', size: 3 * 1024 * 1024 })).toContain('2 MB');
    });

    it('previews, uploads and shows the new picture in the session', () => {
      const fixture = TestBed.createComponent(ProfileSettings);
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' });
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      fixture.componentInstance.choose({ item: () => file, length: 1 } as unknown as FileList);
      fixture.detectChanges();
      expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:preview');

      button(element, 'Save picture').click();
      const request = http.expectOne('/api/v1/users/me/avatar');
      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
      expect((request.request.body as FormData).get('avatar')).toBe(file);
      const avatarUrl = 'avatars/0f8fad5b-d9cb-469f-a165-70867728950e-0123456789abcdef.png';
      request.flush(own({ avatarUrl }));
      fixture.detectChanges();
      expect(session.user()?.avatarUrl).toBe(avatarUrl);
      expect(element.querySelector('[role="status"]')?.textContent).toContain('saved');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    });

    it('refuses an unsupported file without sending it', () => {
      const fixture = TestBed.createComponent(ProfileSettings);
      fixture.detectChanges();
      const file = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
      fixture.componentInstance.choose({ item: () => file, length: 1 } as unknown as FileList);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
        'PNG, JPEG or WebP',
      );
      http.expectNone('/api/v1/users/me/avatar');
    });

    it('renames the account and explains a taken name', () => {
      const fixture = TestBed.createComponent(ProfileSettings);
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      type(element, '#settings-username', 'bob');
      fixture.detectChanges();
      button(element, 'Save username').click();
      http
        .expectOne('/api/v1/users/me')
        .flush(
          { code: 'USERNAME_ALREADY_EXISTS', message: 'taken' },
          { status: 409, statusText: 'Conflict' },
        );
      fixture.detectChanges();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('already taken');

      button(element, 'Save username').click();
      const rename = http.expectOne('/api/v1/users/me');
      expect(rename.request.body).toEqual({ username: 'bob' });
      rename.flush(own({ username: 'bob' }));
      fixture.detectChanges();
      expect(session.user()?.username).toBe('bob');
    });
  });

  describe('security', () => {
    function security(status: object) {
      const fixture = TestBed.createComponent(SecuritySettings);
      fixture.componentRef.setInput('status', {
        hasPassword: true,
        twoFactorEnabled: false,
        recoveryCodesLeft: null,
        ...status,
      });
      fixture.detectChanges();
      return { fixture, element: fixture.nativeElement as HTMLElement };
    }

    it('turns two-factor on with a first code, then shows the recovery codes once', () => {
      const { fixture, element } = security({});
      const changed = vi.fn();
      fixture.componentInstance.changed.subscribe(changed);
      button(element, 'Set up two-factor authentication').click();
      const setup = http.expectOne('/api/v1/auth/2fa/setup');
      expect(setup.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
      setup.flush({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/x',
        qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      });
      fixture.detectChanges();
      expect(element.querySelector<HTMLImageElement>('img.qr')?.src).toMatch(
        /^data:image\/svg\+xml/,
      );
      expect(element.querySelector('.secret')?.textContent).toBe('JBSWY3DPEHPK3PXP');

      type(element, '#enable-2fa-code', '123456');
      button(element, 'Turn on').click();
      const enable = http.expectOne('/api/v1/auth/2fa/enable');
      expect(enable.request.body).toEqual({ code: '123456' });
      const recoveryCodes = Array.from({ length: 10 }, (_, i) => `abcde-${10000 + i}`);
      enable.flush({ recoveryCodes });
      fixture.detectChanges();
      expect([...element.querySelectorAll('.codes code')].map((code) => code.textContent)).toEqual(
        recoveryCodes,
      );
      expect(changed).toHaveBeenCalled();
      button(element, 'I saved them').click();
      fixture.detectChanges();
      expect(element.querySelector('.codes')).toBeNull();
    });

    it('turns two-factor off with a recovery code and reports a wrong code', () => {
      const { fixture, element } = security({ twoFactorEnabled: true, recoveryCodesLeft: 3 });
      expect(element.textContent).toContain('3 recovery codes left');
      type(element, '#manage-2fa-code', 'abcde-12345');
      button(element, 'Turn off').click();
      http
        .expectOne('/api/v1/auth/2fa/disable')
        .flush({ code: 'INVALID_2FA_CODE' }, { status: 401, statusText: 'Unauthorized' });
      fixture.detectChanges();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('not valid');
      expect(session.token()).toBe(accessToken);

      button(element, 'Turn off').click();
      const disable = http.expectOne('/api/v1/auth/2fa/disable');
      expect(disable.request.body).toEqual({ code: 'abcde-12345' });
      disable.flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();
      expect(element.querySelector('[role="status"]')?.textContent).toContain('off');
    });

    it('changes the password after checking both new fields match', () => {
      const { fixture, element } = security({});
      type(element, '#current-password', 'old password');
      type(element, '#new-password', 'new password 1');
      type(element, '#confirm-new-password', 'new password 2');
      button(element, 'Change password').click();
      fixture.detectChanges();
      http.expectNone('/api/v1/auth/password');
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('same');

      type(element, '#confirm-new-password', 'new password 1');
      button(element, 'Change password').click();
      const change = http.expectOne('/api/v1/auth/password');
      expect(change.request.body).toEqual({
        currentPassword: 'old password',
        newPassword: 'new password 1',
      });
      change.flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();
      expect(element.querySelector('[role="status"]')?.textContent).toContain('signed out');
    });

    it('explains why an account without a password has none to change', () => {
      const { element } = security({ hasPassword: false });
      expect(element.querySelector('#current-password')).toBeNull();
      expect(element.textContent).toContain('no password to change');
    });
  });

  describe('your data', () => {
    it('names the export file as the server suggests', () => {
      expect(downloadName('attachment; filename="42chess-alice-2026-11-02.json"', 'x.json')).toBe(
        '42chess-alice-2026-11-02.json',
      );
      expect(downloadName('attachment; filename="../evil.sh"', 'x.json')).toBe('x.json');
      expect(downloadName(null, 'x.json')).toBe('x.json');
    });

    it('deletes the account once the name, password and code are given, then signs out', () => {
      const fixture = TestBed.createComponent(DataSettings);
      fixture.componentRef.setInput('status', {
        hasPassword: true,
        twoFactorEnabled: true,
        recoveryCodesLeft: 10,
      });
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      button(element, 'Delete my account…').click();
      fixture.detectChanges();
      const submit = () => button(element, 'Delete my account for good');
      type(element, '#delete-confirmation', 'Alice');
      type(element, '#delete-password', 'secret password');
      type(element, '#delete-code', '123456');
      fixture.detectChanges();
      expect(submit().disabled).toBe(true);
      type(element, '#delete-confirmation', 'alice');
      fixture.detectChanges();
      expect(submit().disabled).toBe(false);
      submit().click();
      const request = http.expectOne('/api/v1/users/me');
      expect(request.request.method).toBe('DELETE');
      expect(request.request.body).toEqual({
        confirmation: 'alice',
        password: 'secret password',
        code: '123456',
      });
      request.flush(null, { status: 204, statusText: 'No Content' });
      expect(session.authenticated()).toBe(false);
      expect(session.notice()).toContain('deleted');
      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('keeps the account and explains why when a game is running', () => {
      const fixture = TestBed.createComponent(DataSettings);
      fixture.componentRef.setInput('status', {
        hasPassword: false,
        twoFactorEnabled: false,
        recoveryCodesLeft: null,
      });
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      button(element, 'Delete my account…').click();
      fixture.detectChanges();
      expect(element.querySelector('#delete-password')).toBeNull();
      type(element, '#delete-confirmation', 'alice');
      fixture.detectChanges();
      button(element, 'Delete my account for good').click();
      http
        .expectOne('/api/v1/users/me')
        .flush({ code: 'ACTIVE_GAME_EXISTS' }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('current game');
      expect(session.authenticated()).toBe(true);
    });
  });
  describe('privacy', () => {
    const preferences = {
      language: 'en',
      theme: 'system',
      soundEnabled: true,
      messagesFromFriendsOnly: false,
    };

    function open() {
      const fixture = TestBed.createComponent(PrivacySettings);
      fixture.detectChanges();
      http.expectOne('/api/v1/users/me').flush(own({ preferences }));
      http.expectOne('/api/v1/blocks').flush({
        users: [
          { id: 'b1', username: 'bob', avatarUrl: null, blockedAt: '2026-11-01T10:00:00.000Z' },
          { id: 'c1', username: 'carol', avatarUrl: null, blockedAt: '2026-11-02T10:00:00.000Z' },
        ],
      });
      fixture.detectChanges();
      return { fixture, element: fixture.nativeElement as HTMLElement };
    }

    it('lets only friends message or challenge, and says so', () => {
      const { fixture, element } = open();
      const toggle = element.querySelector<HTMLInputElement>('.switch input')!;
      expect(toggle.checked).toBe(false);
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      const request = http.expectOne('/api/v1/users/me');
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ preferences: { messagesFromFriendsOnly: true } });
      request.flush(own({ preferences: { ...preferences, messagesFromFriendsOnly: true } }));
      fixture.detectChanges();
      expect(element.querySelector('[role="status"]')?.textContent).toContain(
        'Only your friends can message or challenge you now.',
      );
    });

    it('puts the switch back when the choice cannot be saved', () => {
      const { fixture, element } = open();
      const toggle = element.querySelector<HTMLInputElement>('.switch input')!;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      http
        .expectOne('/api/v1/users/me')
        .flush({ code: 'INTERNAL_SERVER_ERROR' }, { status: 500, statusText: 'Error' });
      fixture.detectChanges();
      expect(toggle.checked).toBe(false);
      expect(element.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('lists blocked players and unblocks one', () => {
      const { fixture, element } = open();
      const names = () =>
        [...element.querySelectorAll('ul[aria-label="Blocked players"] strong')].map(
          (name) => name.textContent,
        );
      expect(names()).toEqual(['bob', 'carol']);
      element.querySelector<HTMLButtonElement>('button[aria-label="Unblock bob"]')!.click();
      const request = http.expectOne('/api/v1/blocks/b1');
      expect(request.request.method).toBe('DELETE');
      request.flush(null);
      fixture.detectChanges();
      expect(names()).toEqual(['carol']);
    });
  });
});
