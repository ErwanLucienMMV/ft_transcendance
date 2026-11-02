import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAUTH_LABELS, OAuthProvider, OAuthService } from '../../core/auth/oauth.service';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

@Component({
  selector: 'app-oauth-sign-in',
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      @if (oauth.providers().length) {
        <div class="oauth-options" [attr.aria-label]="t('auth.oauth.others')">
          @for (provider of oauth.providers(); track provider) {
            <button class="button secondary" type="button" (click)="start(provider)">
              {{ t('auth.oauth.continueWith', { provider: labels[provider] }) }}
            </button>
          }
        </div>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
    </ng-container>
  `,
  styles: ['.oauth-options { display: flex; flex-wrap: wrap; gap: 12px; margin-block: 20px; }'],
})
export class OAuthSignIn implements OnInit {
  readonly oauth = inject(OAuthService);
  readonly error = signal('');
  readonly labels = OAUTH_LABELS;
  private readonly destroyRef = inject(DestroyRef);
  ngOnInit() {
    this.oauth.loadProviders().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  start(provider: OAuthProvider) {
    try {
      if (!this.oauth.start(provider)) this.error.set(tr('auth.oauth.unavailable'));
    } catch {
      this.error.set(tr('auth.oauth.openFailed'));
    }
  }
}
