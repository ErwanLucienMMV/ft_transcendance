import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api/api-base-url';
import { I18n } from '../../core/i18n/i18n';
import { PREFERENCES_KEY, Preferences } from '../../core/preferences/preferences';
import { LanguageSelect } from './language-select';

describe('Language select', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });
  });

  afterEach(async () => {
    localStorage.removeItem(PREFERENCES_KEY);
    await TestBed.inject(I18n).use('en');
  });

  async function render() {
    const fixture = TestBed.createComponent(LanguageSelect);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('select') as HTMLSelectElement;
  }

  it('shows the saved language when the page opens', async () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ language: 'fr' }));
    const select = await render();
    expect(select.value).toBe('fr');
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'English',
      'Français',
      'Español',
    ]);
  });

  it('switches the language when another one is picked', async () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ language: 'en' }));
    const select = await render();
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    expect(TestBed.inject(Preferences).language()).toBe('es');
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!).language).toBe('es');
  });
});
