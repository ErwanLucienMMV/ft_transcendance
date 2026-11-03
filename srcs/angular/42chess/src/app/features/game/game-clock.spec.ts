import { TestBed } from '@angular/core/testing';
import { formatClock, GameClock } from './game-clock';

describe('Game clock', () => {
  it('formats minutes and seconds, with tenths under ten seconds', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(61_999)).toBe('1:01');
    expect(formatClock(9_870)).toBe('0:09.8');
    expect(formatClock(-5)).toBe('0:00.0');
    expect(formatClock(9_870, false)).toBe('0:09');
  });

  it('turns red under ten seconds and announces the time', () => {
    const fixture = TestBed.createComponent(GameClock);
    fixture.componentRef.setInput('remaining', 15_000);
    fixture.componentRef.setInput('running', true);
    fixture.componentRef.setInput('label', 'White');
    fixture.detectChanges();
    const clock = fixture.nativeElement.querySelector('[role="timer"]') as HTMLElement;
    expect(clock.classList).not.toContain('low');
    expect(clock.getAttribute('aria-label')).toBe('White clock, 0 minutes 15 seconds');
    fixture.componentRef.setInput('remaining', 9_500);
    fixture.componentRef.setInput('running', false);
    fixture.detectChanges();
    expect(clock.classList).toContain('low');
    fixture.componentRef.setInput('remaining', null);
    fixture.detectChanges();
    expect(clock.textContent?.trim()).toBe('--:--');
  });
});
