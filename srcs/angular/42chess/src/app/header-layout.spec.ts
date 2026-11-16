import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HeaderLayoutDirective } from './header-layout';

@Component({
  imports: [HeaderLayoutDirective],
  template: `
    <header appHeaderLayout>
      <div class="header-inner">
        <a class="brand">42chess</a>
        <nav class="main-nav">
          <a>{{ label() }}</a>
        </nav>
        <nav class="account"><button>Sign out</button></nav>
      </div>
    </header>
  `,
})
class Host {
  readonly label = signal('Play');
}

/**
 * jsdom lays nothing out. The stubs stand for a header whose one-row layouts need 1100 px with
 * the name and 900 px without it (more for longer labels), and whose two-row layout keeps the
 * account beside the brand from 360 px.
 */
describe('HeaderLayoutDirective', () => {
  let available: number;
  let resize: (() => void) | undefined;
  const layoutOf = (element: Element) =>
    (element.closest('header') as HTMLElement).dataset['layout'];
  const box = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

  beforeEach(() => {
    available = 1200;
    resize = undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
          resize = () => callback([{ contentRect: { width: available } }]);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('header-inner') ? available : 0;
    });
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
      if (!this.classList.contains('header-inner')) return 0;
      const label = this.querySelector('.main-nav a')?.textContent ?? '';
      const needs = { wide: 1100, compact: 900 }[layoutOf(this) as string] ?? 0;
      return Math.max(available, needs + 10 * label.length);
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      // Below 360 px, the account of the two-row layout wraps under the brand.
      const wrapped = layoutOf(this) === 'stacked' && available < 360;
      return this.classList.contains('account') && wrapped ? box(50, 86) : box(10, 46);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset['layout'] === 'stacked' || this.dataset['layout'] === 'narrow' ? 99 : 65;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const header = (fixture.nativeElement as HTMLElement).querySelector('header') as HTMLElement;
    return { fixture, layout: () => header.dataset['layout'] };
  }
  const offset = () => document.documentElement.style.getPropertyValue('--header-offset');

  it('keeps everything on one row, with the name, while it fits', async () => {
    const { layout } = await render();
    expect(layout()).toBe('wide');
    expect(offset()).toBe('65px');
  });

  it('drops the name, moves the sections down, then drops the site name, as the window narrows', async () => {
    available = 1000;
    const { layout } = await render();
    expect(layout()).toBe('compact');

    available = 800;
    resize?.();
    expect(layout()).toBe('stacked');
    expect(offset()).toBe('99px');

    available = 320;
    resize?.();
    expect(layout()).toBe('narrow');

    available = 1200;
    resize?.();
    expect(layout()).toBe('wide');
    expect(offset()).toBe('65px');
  });

  it('measures again when the content changes, as with another language', async () => {
    const { fixture, layout } = await render();
    expect(layout()).toBe('wide');
    fixture.componentInstance.label.set('Clasificación');
    await fixture.whenStable();
    expect(layout()).toBe('compact');
    fixture.componentInstance.label.set('Play');
    await fixture.whenStable();
    expect(layout()).toBe('wide');
  });

  it('leaves the default offset to the stylesheet once the header is gone', async () => {
    const { fixture } = await render();
    expect(offset()).toBe('65px');
    fixture.destroy();
    expect(offset()).toBe('');
  });
});
