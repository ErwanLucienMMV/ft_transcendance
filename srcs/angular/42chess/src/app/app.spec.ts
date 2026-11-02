import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { API_BASE_URL } from './core/api/api-base-url';
import { Preferences } from './core/preferences/preferences';
import { PageTitle } from './core/title/page-title';
import { ErrorState } from './core/errors/error-state';
import { AuthSession } from './core/auth/auth-session';
import { RealtimeService } from './core/realtime/realtime.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: TitleStrategy, useExisting: PageTitle },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('leaves the page title (h1) to each page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')).toBeNull();
  });

  it('keeps the realtime socket open while signed in, so friends see the user online', async () => {
    const connect = vi
      .spyOn(TestBed.inject(RealtimeService), 'connect')
      .mockImplementation(() => {});
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(connect).not.toHaveBeenCalled();
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    await fixture.whenStable();
    expect(connect).toHaveBeenCalledTimes(1);
    TestBed.inject(AuthSession).clear();
  });

  it('announces global errors in a toast and lets the user dismiss them', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(ErrorState).reportUnexpected();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="alert"]')?.textContent).toContain(
      'Something went wrong.',
    );
    (compiled.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(compiled.querySelector('[role="alert"]')).toBeNull();
    expect(compiled.querySelector('nav[aria-label="Main navigation"]')).not.toBeNull();
  });

  it('clears an error toast when the player changes page', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(ErrorState).reportUnexpected();
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/elsewhere');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
  });

  it('counts unread messages in the header and the tab title', async () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    await fixture.whenStable();
    http.match('/api/v1/users/me').forEach((request) => request.flush({}));
    http.expectOne('/api/v1/conversations').flush({
      conversations: [
        { user: { id: 'a', username: 'a' }, unreadCount: 2 },
        { user: { id: 'b', username: 'b' }, unreadCount: 0 },
      ],
    });
    await fixture.whenStable();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('[data-unread]');
    expect(badge?.textContent?.trim()).toBe('2 unread');
    expect(TestBed.inject(Title).getTitle()).toMatch(/^\(2\) /);
    TestBed.inject(AuthSession).clear();
  });

  it('switches the theme from the footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const light = (fixture.nativeElement as HTMLElement).querySelector(
      '.footer-theme [data-value="light"]',
    ) as HTMLButtonElement;
    light.click();
    await fixture.whenStable();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(TestBed.inject(Preferences).theme()).toBe('light');
    TestBed.inject(Preferences).setTheme('system');
  });

  it('links the legal pages from the footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        'footer nav[aria-label="Legal"] a',
      ),
    ];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Privacy Policy', '/privacy'],
      ['Terms of Service', '/terms'],
    ]);
  });
});
