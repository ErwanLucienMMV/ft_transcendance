import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { ErrorState } from './core/errors/error-state';
import { AuthSession } from './core/auth/auth-session';
import { RealtimeService } from './core/realtime/realtime.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Hello, 42chess');
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

  it('announces global errors and lets the user dismiss them', async () => {
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
