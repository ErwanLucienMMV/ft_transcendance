import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { provideRouter, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { PageTitle } from './core/title/page-title';
import { LoginPage } from './features/auth/login-page';
import { RegisterPage } from './features/auth/register-page';
import { HomePage } from './features/home/home-page';
import { NotFoundPage } from './features/home/not-found-page';
import { PrivacyPage } from './features/legal/privacy-page';
import { TermsPage } from './features/legal/terms-page';

describe('Application navigation', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        { provide: TitleStrategy, useClass: PageTitle },
      ],
    }),
  );
  /** The tab title, once the title strategy has drawn it. */
  const title = () => {
    TestBed.tick();
    return TestBed.inject(Title).getTitle();
  };

  it('opens each public page and updates its document title', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', HomePage);
    expect(harness.routeNativeElement?.querySelector('.eyebrow')?.textContent).toBe('Play chess');
    expect(harness.routeNativeElement?.querySelectorAll('h1').length).toBe(1);
    await harness.navigateByUrl('/login', LoginPage);
    expect(harness.routeNativeElement?.querySelector('label[for="login"]')?.textContent).toBe(
      'Username or email address',
    );
    expect(title()).toBe('Sign in | 42 Chess');
    await harness.navigateByUrl('/register', RegisterPage);
    expect(harness.routeNativeElement?.querySelector('#register-confirm-password')).not.toBeNull();
    expect(title()).toBe('Create an account | 42 Chess');
  });

  it('serves the privacy policy and terms of service, each linking to the other', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/privacy', PrivacyPage);
    const privacy = harness.routeNativeElement as HTMLElement;
    expect(privacy.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(title()).toBe('Privacy Policy | 42 Chess');
    expect(privacy.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-02');
    expect(privacy.querySelectorAll('h2').length).toBeGreaterThanOrEqual(8);
    expect(privacy.textContent).toContain('refresh_token');
    expect(privacy.querySelector('a[href="/terms"]')).not.toBeNull();
    await harness.navigateByUrl('/terms', TermsPage);
    const terms = harness.routeNativeElement as HTMLElement;
    expect(terms.querySelector('h1')?.textContent).toBe('Terms of Service');
    expect(title()).toBe('Terms of Service | 42 Chess');
    expect(terms.textContent).toContain('Fair play');
    expect(terms.querySelector('a[href="/privacy"]')).not.toBeNull();
  });

  it('shows a useful not-found page for an unknown address', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/does-not-exist', NotFoundPage);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Page not found');
    expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(title()).toBe('Page not found | 42 Chess');
  });
});
