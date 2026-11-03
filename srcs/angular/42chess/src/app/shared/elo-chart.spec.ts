import { TestBed } from '@angular/core/testing';
import { EloChart } from './elo-chart';

describe('Elo chart', () => {
  function render(history: { ratingBefore: number; ratingAfter: number; createdAt: string }[]) {
    const fixture = TestBed.createComponent(EloChart);
    fixture.componentRef.setInput('history', history);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the rating oldest first, from the rating before the first game', () => {
    const element = render([
      { ratingBefore: 1216, ratingAfter: 1200, createdAt: '2026-10-02' },
      { ratingBefore: 1200, ratingAfter: 1216, createdAt: '2026-10-01' },
    ]);
    const points = element.querySelector('polyline')?.getAttribute('points')?.split(' ');
    expect(points).toHaveLength(3);
    expect(points?.[0].startsWith('0.0,')).toBe(true);
    expect(points?.[2].startsWith('600.0,')).toBe(true);
    expect(
      [...element.querySelectorAll('figcaption span')].map((span) => span.textContent),
    ).toEqual(['Low 1200', 'High 1216', 'Now 1200']);
  });

  it('draws nothing without a rated game', () => {
    expect(render([]).querySelector('svg')).toBeNull();
  });
});
