import { Component, input } from '@angular/core';
import { ChessArtwork } from './chess-artwork';
import { TranslocoDirective } from '@jsverse/transloco';

/** Card used by the sign-in pages, with a board beside it on wide screens. */
@Component({
  selector: 'app-auth-frame',
  imports: [TranslocoDirective, ChessArtwork],
  template: `
    <ng-container *transloco="let t">
      <div class="auth-layout" [class.with-aside]="aside()">
        @if (aside()) {
          <aside class="auth-aside" aria-hidden="true">
            <div class="auth-board"><app-chess-artwork /></div>
            <p class="auth-quote">
              {{ t('home.frame.quoteStart') }} <span>{{ t('home.frame.quoteAccent') }}</span>
            </p>
            <ul>
              <li>{{ t('home.frame.rated') }}</li>
              <li>{{ t('home.frame.computer') }}</li>
              <li>{{ t('home.frame.puzzle') }}</li>
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
    </ng-container>
  `,
})
export class AuthFrame {
  /** False for pages that are not about the account, such as the not-found page. */
  readonly aside = input(true);
}
