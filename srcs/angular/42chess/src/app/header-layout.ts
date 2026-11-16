import { DOCUMENT } from '@angular/common';
import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** The header layouts, roomiest first. */
export const HEADER_LAYOUTS = ['wide', 'compact', 'stacked', 'narrow'] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];

/**
 * Sets `data-layout` on the site header to the roomiest layout that fits its width: one row
 * with the player's name and Elo (`wide`), one row without them (`compact`), the sections on a
 * second row (`stacked`), then the logo without the site name (`narrow`). It measures rather
 * than using breakpoints, because the width of the header follows the language, the session,
 * the player's name and the unread count.
 *
 * The header holds a `.header-inner` row with a `.brand`, a `.main-nav` and an `.account`. One
 * row fits when neither the row nor the sections are wider than their box; two rows fit when
 * the brand and the account share the first one. Before the first measure, as on a prerendered
 * page, the stylesheet guesses from the screen width. The header's height is published on the
 * root as `--header-offset`.
 */
@Directive({ selector: '[appHeaderLayout]' })
export class HeaderLayoutDirective {
  constructor() {
    const header = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const document = inject(DOCUMENT);
    const fonts = document.fonts as FontFaceSet | undefined;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const row = header.querySelector<HTMLElement>('.header-inner');
      const brand = header.querySelector<HTMLElement>('.brand');
      const nav = header.querySelector<HTMLElement>('.main-nav');
      const account = header.querySelector<HTMLElement>('.account');
      if (!row || !brand || !nav || !account) return;
      const overflows = (element: HTMLElement) => element.scrollWidth > element.clientWidth + 1;
      const fits = (layout: HeaderLayout) =>
        layout === 'wide' || layout === 'compact'
          ? !overflows(row) && !overflows(nav)
          : account.getBoundingClientRect().top < brand.getBoundingClientRect().bottom;
      const root = document.documentElement;
      // Each try is laid out synchronously, so only the chosen layout is ever painted.
      const update = () => {
        for (const layout of HEADER_LAYOUTS) {
          header.dataset['layout'] = layout;
          if (layout === 'narrow' || fits(layout)) break;
        }
        // Toasts and anchors keep clear of the header, which is taller on two rows.
        root.style.setProperty('--header-offset', `${header.offsetHeight}px`);
      };
      update();

      // The row's width follows the window and its gutters; a layout only alters its height.
      let width: number | undefined;
      const resize =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(([entry]) => {
              if (entry.contentRect.width === width) return;
              width = entry.contentRect.width;
              update();
            })
          : null;
      resize?.observe(row);
      // A new language, a sign-in, a renamed player or an unread count change the content.
      const content = new MutationObserver(update);
      content.observe(row, { childList: true, characterData: true, subtree: true });
      // The text gets wider once the self-hosted fonts replace the fallback ones.
      fonts?.addEventListener('loadingdone', update);
      destroyRef.onDestroy(() => {
        resize?.disconnect();
        content.disconnect();
        fonts?.removeEventListener('loadingdone', update);
        root.style.removeProperty('--header-offset');
      });
    });
  }
}
