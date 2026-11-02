import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BoardPage } from './board-page';

describe('Analysis board page', () => {
  let query: Record<string, string>;
  beforeEach(() => {
    query = {};
    TestBed.configureTestingModule({
      imports: [BoardPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useFactory: () => ({ queryParamMap: of(convertToParamMap(query)) }),
        },
      ],
    });
  });

  function setup() {
    const fixture = TestBed.createComponent(BoardPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const click = (selector: string) => {
      (element.querySelector(selector) as HTMLElement).click();
      fixture.detectChanges();
    };
    return { fixture, element, click };
  }

  it('plays both sides locally and highlights the last move', () => {
    const { element, click, fixture } = setup();
    click('[data-square="e2"]');
    click('[data-square="e4"]');
    expect(fixture.componentInstance.fen()).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(element.querySelector('[role="status"]')?.textContent).toBe('Black to move.');
    click('[data-square="e7"]');
    click('[data-square="e5"]');
    expect(element.querySelector('[data-square="e5"]')?.classList).toContain('last-move');
  });

  it('loads a FEN, rejects an invalid one and flips the board', () => {
    const { element, click, fixture } = setup();
    const input = element.querySelector('#fen') as HTMLInputElement;
    input.value = 'nonsense';
    click('form button[type="submit"]');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = '  4k3/8/8/8/8/8/8/4K3   w - - 0 1 ';
    click('form button[type="submit"]');
    expect(fixture.componentInstance.fen()).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(element.querySelector('#fen-error')).toBeNull();
    click('.panel-actions button');
    expect(element.querySelector('.square')?.getAttribute('data-square')).toBe('h1');
  });

  it('lists the moves in notation and takes them back', () => {
    const { element, click, fixture } = setup();
    click('[data-square="g1"]');
    click('[data-square="f3"]');
    click('[data-square="d7"]');
    click('[data-square="d5"]');
    expect(element.querySelector('.move-list li')?.textContent?.replace(/\s+/g, '')).toBe('Nf3d5');
    const takeBack = [...element.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Take back'),
    )!;
    takeBack.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fen()).toBe(
      'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
    );
    expect(element.querySelector('[data-square="f3"]')?.classList).toContain('last-move');
  });

  it('opens the position given in the address, such as the end of a game', () => {
    query = { fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 40' };
    const { fixture } = setup();
    expect(fixture.componentInstance.fen()).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 40');
  });
});
