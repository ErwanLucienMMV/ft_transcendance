import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProgressionApi } from './progression-api';
import { RulesPage } from './rules-page';

const rules = {
  xp: {
    game: { win: 30, draw: 15, loss: 10 },
    bot: { EASY: { win: 10, draw: 5 }, MEDIUM: { win: 20, draw: 10 }, HARD: { win: 40, draw: 20 } },
    minimumMovesEach: 2,
    puzzle: { daily: 20, archive: 10 },
    hintDivisor: 2,
    streakBonusPerDay: 5,
    streakBonusCap: 7,
    maxPuzzleMistakes: 3,
  },
  levels: [
    { level: 1, xp: 0 },
    { level: 2, xp: 100 },
  ],
  achievements: [
    { code: 'LEVEL_5', name: 'Rising star', description: 'Reach level 5.', goal: 5, xp: 0 },
    { code: 'FIRST_WIN', name: 'First victory', description: 'Win a game.', goal: 1, xp: 20 },
  ],
};

describe('Progression rules page', () => {
  function create(response = of(rules)) {
    TestBed.configureTestingModule({
      imports: [RulesPage],
      providers: [
        provideRouter([]),
        { provide: ProgressionApi, useValue: { rules: () => response } },
      ],
    });
    const fixture = TestBed.createComponent(RulesPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the XP the server awards, the levels and the achievements', () => {
    const element = create();
    const rows = [...element.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.children].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()).join(' '),
    );
    expect(rows[0]).toBe('Win, draw or lose a game against a player 30 · 15 · 10');
    expect(rows).toContain('Daily streak bonus, per day of streak +5, up to +35');
    expect(element.textContent).toContain('3 wrong moves end an attempt');
    expect(element.textContent).toContain('20 becomes 10');
    expect(
      [...element.querySelectorAll('.levels li')].map(
        (li) =>
          `${li.querySelector('strong')?.textContent}: ${li.querySelector('span')?.textContent}`,
      ),
    ).toEqual(['Level 1: 0 XP', 'Level 2: 100 XP']);
    expect(
      [...element.querySelectorAll('.achievements small')].map((small) => small.textContent),
    ).toEqual(['Badge only', '+20 XP']);
  });

  it('keeps the static rules when the table cannot be loaded', () => {
    const element = create(throwError(() => new Error('down')));
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(element.textContent).toContain('Every account starts at 1200');
  });
});
