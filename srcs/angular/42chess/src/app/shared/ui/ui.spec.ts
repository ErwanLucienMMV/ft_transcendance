import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Alert, Tone } from './alert';
import { Badge } from './badge';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState } from './empty-state';
import { ICONS, Icon } from './icon';
import { Pager } from './pager';
import { Segmented } from './segmented';
import { Spinner } from './spinner';
import { Toasts } from './toasts';

@Component({
  imports: [Alert, Badge, ConfirmDialog, EmptyState, Icon, Pager, Segmented, Spinner],
  template: `
    <app-alert
      [tone]="tone()"
      heading="Heads up"
      [dismissible]="true"
      (dismissed)="dismissed = true"
    >
      <p>Body</p>
    </app-alert>
    <app-empty-state piece="pawn" heading="Nothing yet"><p>Play a game.</p></app-empty-state>
    <app-empty-state class="loading" [loading]="true"><p>Loading…</p></app-empty-state>
    <app-pager [page]="page()" [pages]="3" (pageChange)="page.set($event)" />
    <app-segmented label="Speed" [options]="speeds" [(value)]="speed" />
    <app-confirm-dialog
      heading="Remove?"
      confirmLabel="Remove"
      tone="danger"
      (confirmed)="answers.push('yes')"
      (cancelled)="answers.push('no')"
    >
      <p>Sure?</p>
    </app-confirm-dialog>
    <app-badge tone="accent">3</app-badge>
    <app-spinner label="Saving…" />
    <app-icon name="check" />
  `,
})
class Gallery {
  readonly tone = signal<Tone>('error');
  readonly page = signal(1);
  readonly speeds = [
    { value: 'slow', label: 'Slow' },
    { value: 'fast', label: 'Fast' },
    { value: 'blitz', label: 'Blitz' },
  ];
  readonly speed = signal('slow');
  readonly answers: string[] = [];
  dismissed = false;
  readonly dialog = viewChild.required(ConfirmDialog);
}

describe('Design system components', () => {
  async function render() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Gallery);
    await fixture.whenStable();
    return {
      fixture,
      element: fixture.nativeElement as HTMLElement,
      page: fixture.componentInstance,
    };
  }

  it('interrupts for errors and warnings only, and can be dismissed', async () => {
    const { fixture, element, page } = await render();
    const alert = element.querySelector('app-alert')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.querySelector('strong')?.textContent).toBe('Heads up');
    page.tone.set('success');
    await fixture.whenStable();
    expect(alert.getAttribute('role')).toBe('status');
    expect(alert.getAttribute('data-tone')).toBe('success');
    (alert.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement).click();
    expect(page.dismissed).toBe(true);
  });

  it('shows an empty state with its piece, and announces a loading one', async () => {
    const { element } = await render();
    const [empty, loading] = [...element.querySelectorAll('app-empty-state')];
    expect(empty.classList).toContain('empty');
    expect(empty.querySelector('use')?.getAttribute('href')).toBe('/chess-pieces.svg#pawn');
    expect(empty.getAttribute('role')).toBeNull();
    expect(loading.getAttribute('role')).toBe('status');
  });

  it('pages forward and back, never past either end', async () => {
    const { fixture, element, page } = await render();
    const [previous, next] = [...element.querySelectorAll<HTMLButtonElement>('app-pager button')];
    expect(previous.disabled).toBe(true);
    next.click();
    await fixture.whenStable();
    expect(page.page()).toBe(2);
    expect(element.querySelector('app-pager [aria-current]')?.textContent).toBe('Page 2 of 3');
    next.click();
    await fixture.whenStable();
    expect(next.disabled).toBe(true);
  });

  it('moves a segmented choice with the arrow keys, like a radio group', async () => {
    const { fixture, element, page } = await render();
    const radios = () => [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(element.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Speed');
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    radios()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(page.speed()).toBe('blitz');
    expect(document.activeElement).toBe(radios()[2]);
    radios()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    radios()[1].click();
    await fixture.whenStable();
    expect(page.speed()).toBe('fast');
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
  });

  it('asks before an action and reports the answer once', async () => {
    const { fixture, element, page } = await render();
    const dialog = element.querySelector('dialog')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    page.dialog().open();
    expect(dialog.hasAttribute('open')).toBe(true);
    const button = (name: string) =>
      [...dialog.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)!;
    expect(button('Remove').classList).toContain('danger');
    button('Cancel').click();
    page.dialog().open();
    button('Remove').click();
    // Answering a closed dialog does nothing.
    page.dialog().answer(true);
    await fixture.whenStable();
    expect(page.answers).toEqual(['no', 'yes']);
  });

  it('labels a spinner for screen readers and draws every icon', async () => {
    const { element } = await render();
    const spinner = element.querySelector('app-spinner')!;
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.textContent).toBe('Saving…');
    expect(element.querySelector('app-badge')?.getAttribute('data-tone')).toBe('accent');
    expect(element.querySelector('app-icon svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(Object.keys(ICONS).length).toBeGreaterThanOrEqual(20);
  });

  it('keeps at most four toasts, one per key, and clears them by tone', () => {
    vi.useFakeTimers();
    try {
      const toasts = TestBed.inject(Toasts);
      for (const text of ['a', 'b', 'c', 'd', 'e']) toasts.show(text);
      expect(toasts.items().map((toast) => toast.text)).toEqual(['b', 'c', 'd', 'e']);
      toasts.error('first', { key: 'save' });
      toasts.error('second', { key: 'save' });
      expect(
        toasts
          .items()
          .filter((toast) => toast.key === 'save')
          .map((toast) => toast.text),
      ).toEqual(['second']);
      toasts.clear('error');
      expect(toasts.items().some((toast) => toast.tone === 'error')).toBe(false);
      toasts.success('saved', { duration: 1000 });
      vi.advanceTimersByTime(1000);
      expect(toasts.items().some((toast) => toast.text === 'saved')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
