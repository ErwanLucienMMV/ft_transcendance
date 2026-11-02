import { Component, input } from '@angular/core';
import { ChessArtwork } from './chess-artwork';

/** Card used by the sign-in pages, with a board beside it on wide screens. */
@Component({
  selector: 'app-auth-frame',
  imports: [ChessArtwork],
  template: `
    <div class="auth-layout" [class.with-aside]="aside()">
      @if (aside()) {
        <aside class="auth-aside" aria-hidden="true">
          <div class="auth-board"><app-chess-artwork /></div>
          <p class="auth-quote">Every move tells <span>a story.</span></p>
          <ul>
            <li>Rated games against players of your level</li>
            <li>A computer opponent with three strengths</li>
            <li>A new puzzle every day</li>
          </ul>
        </aside>
      }
      <section class="auth-card">
        <span class="auth-mark" aria-hidden="true"
          ><svg viewBox="0 0 64 64"><use href="/chess-pieces.svg#knight" /></svg
        ></span>
        <ng-content />
      </section>
    </div>
  `,
})
export class AuthFrame {
  /** False for pages that are not about the account, such as the not-found page. */
  readonly aside = input(true);
}
