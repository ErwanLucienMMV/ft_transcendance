import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrivacyPage } from '../../features/legal/privacy-page';
import { RulesPage } from '../../features/help/rules-page';
import { resultText, spokenMove } from '../../shared/chess/game-text';
import { LocalDatePipe } from '../../shared/ui/local-date';
import { currentLanguage, currentLocale, I18n, tr, trCount, trIfExists } from './i18n';
import { browserLanguage } from './languages';

describe('Languages', () => {
  const use = (language: 'en' | 'fr' | 'es') => TestBed.inject(I18n).use(language);

  afterEach(async () => {
    await use('en');
  });

  it('starts in English', () => {
    expect(currentLanguage()).toBe('en');
    expect(tr('app.nav.play')).toBe('Play');
    expect(trCount('game.watchers', 1)).toBe('1 spectator watching');
  });

  it('switches every text, the page language and the locale', async () => {
    await use('fr');
    expect(currentLanguage()).toBe('fr');
    expect(currentLocale()).toBe('fr-FR');
    expect(document.documentElement.lang).toBe('fr');
    expect(tr('app.nav.play')).toBe('Jouer');
    expect(trCount('game.watchers', 1)).toBe('1 spectateur regarde');
    expect(trCount('game.watchers', 3)).toBe('3 spectateurs regardent');
    expect(new LocalDatePipe().transform('2026-11-02', 'longDate', 'UTC')).toBe('2 novembre 2026');

    await use('es');
    expect(tr('app.nav.play')).toBe('Jugar');
    expect(new LocalDatePipe().transform('2026-11-02', 'longDate', 'UTC')).toBe(
      '2 de noviembre de 2026',
    );
  });

  it('reads moves and results aloud in the language shown', async () => {
    await use('fr');
    expect(spokenMove('Nf3+', 'BLACK')).toBe('Noirs : Cavalier en f3, échec');
    expect(spokenMove('exd5', 'WHITE')).toBe('Blancs : pion e prend en d5');
    expect(spokenMove('O-O', 'WHITE')).toBe('Blancs : petit roque');
    expect(resultText({ winner: 'WHITE', reason: 'CHECKMATE' })).toBe(
      'Les Blancs gagnent par échec et mat',
    );
    await use('es');
    expect(spokenMove('Nf3#', 'BLACK')).toBe('Negras: Caballo a f3, jaque mate');
    expect(resultText({ winner: 'WHITE', reason: 'CHECKMATE' })).toBe(
      'Ganan las blancas por jaque mate',
    );
  });

  it('leaves unknown codes to the caller', () => {
    expect(trIfExists('errors.codes.NOT_A_REAL_CODE' as never)).toBeNull();
  });

  it('shows the long pages in the language picked', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const privacy = TestBed.createComponent(PrivacyPage);
    await privacy.whenStable();
    const element = privacy.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(element.textContent).toContain('Messages:');

    await use('fr');
    privacy.detectChanges();
    await privacy.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Politique de confidentialité');
    expect(element.querySelector('time')?.textContent).toBe('2 novembre 2026');
    expect(element.querySelectorAll('h2').length).toBeGreaterThanOrEqual(8);
    expect(element.textContent).toContain('refresh_token');
    expect(element.textContent).toContain("Vous et l'autre joueur seulement");
    expect(element.querySelector('a[href="/terms"]')?.textContent).toBe("Conditions d'utilisation");

    await use('es');
    const rules = TestBed.createComponent(RulesPage);
    await rules.whenStable();
    const help = rules.nativeElement as HTMLElement;
    expect(help.querySelector('h2')?.textContent).toBe('Ganar');
    expect([...help.querySelectorAll('li')].map((item) => item.textContent).at(-1)).toBe(
      '30 + 0 (Clásica)',
    );
  });

  it('picks the first supported language of the browser', () => {
    expect(browserLanguage(['de-DE', 'es-MX', 'fr'])).toBe('es');
    expect(browserLanguage(['de'])).toBe('en');
    expect(browserLanguage(undefined)).toBe('en');
  });
});
