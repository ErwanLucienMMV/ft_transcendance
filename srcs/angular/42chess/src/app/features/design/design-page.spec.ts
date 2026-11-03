import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api/api-base-url';
import { Preferences } from '../../core/preferences/preferences';
import { ICONS } from '../../shared/ui/icon';
import { Toasts } from '../../shared/ui/toasts';
import { DesignPage, PALETTE } from './design-page';

describe('Design system page', () => {
  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    const fixture = TestBed.createComponent(DesignPage);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows every colour token, icon and component', async () => {
    const { element } = await render();
    expect(element.querySelector('h1')?.textContent).toBe('How 42 Chess looks');
    const tokens = [...element.querySelectorAll('.swatches code')].map((code) => code.textContent);
    expect(tokens).toEqual(PALETTE.flatMap((group) => group.tokens));
    expect(element.querySelectorAll('.icons app-icon').length).toBe(Object.keys(ICONS).length);
    for (const selector of [
      'app-alert[data-tone="error"]',
      'app-alert[data-tone="info"]',
      'app-empty-state',
      'app-spinner',
      'app-badge[data-tone="danger"]',
      'app-segmented',
      'app-pager',
      'app-confirm-dialog',
      'app-chess-board',
      'app-captured-pieces',
      'app-move-list',
      'app-avatar',
      'app-presence-badge',
      'app-level-bar',
    ])
      expect(element.querySelector(selector), selector).not.toBeNull();
  });

  it('tries the toasts, the dialog and the theme in place', async () => {
    const { fixture, element } = await render();
    const button = (name: string) =>
      [...element.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)!;
    button('Show success').click();
    expect(
      TestBed.inject(Toasts)
        .items()
        .map((toast) => toast.tone),
    ).toEqual(['success']);
    button('Remove a friend…').click();
    button('Cancel').click();
    await fixture.whenStable();
    expect(element.querySelector('[role="status"].muted')?.textContent).toContain('kept');
    (element.querySelector('.page-head [data-value="light"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(document.documentElement.dataset['theme']).toBe('light');
    TestBed.inject(Preferences).setTheme('system');
  });
});
