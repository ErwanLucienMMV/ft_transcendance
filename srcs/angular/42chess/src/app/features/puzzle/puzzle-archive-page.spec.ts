import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { PuzzleArchivePage } from './puzzle-archive-page';
import { PuzzlesApi } from './puzzles-api';

describe('Puzzle archive page', () => {
  let archive: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    archive = vi.fn(() =>
      of({
        total: 3,
        items: [
          { id: 'p3', date: '2026-11-01', rating: 1500, themes: [], status: 'SOLVED' },
          { id: 'p2', date: '2026-10-31', rating: 1300, themes: [], status: 'FAILED' },
          { id: 'p1', date: '2026-10-30', rating: 900, themes: [], status: null },
        ],
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'puzzle/archive', component: PuzzleArchivePage }]),
        { provide: PuzzlesApi, useValue: { archive } },
      ],
    });
  });

  it('lists earlier puzzles with how the player did and links to each', async () => {
    const harness = await RouterTestingHarness.create('/puzzle/archive');
    const element = harness.routeNativeElement as HTMLElement;
    expect(archive).toHaveBeenCalledWith(0);
    const rows = [...element.querySelectorAll('.puzzles a')];
    expect(
      rows.map((a) => [...a.children].map((cell) => cell.textContent?.trim()).join(' ')),
    ).toEqual(['2026-11-01 1500 Solved', '2026-10-31 1300 Failed', '2026-10-30 900 Not tried']);
    expect(rows[0].getAttribute('href')).toBe('/puzzle/p3');
    expect(element.querySelector('.pager')).toBeNull();
  });

  it('offers to try again when the archive fails', async () => {
    archive.mockReturnValueOnce(throwError(() => new Error('down')));
    const harness = await RouterTestingHarness.create('/puzzle/archive');
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    (element.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(element.querySelectorAll('.puzzles a')).toHaveLength(3);
  });
});
