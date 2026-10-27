import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAuthProvider, OAuthService } from '../../core/auth/oauth.service';

@Component({
  selector: 'app-oauth-sign-in',
  template: `
    @if (oauth.providers().length) {
      <div class="oauth-options" aria-label="Other sign-in methods">
        @for (provider of oauth.providers(); track provider) {
          <button class="button secondary" type="button" (click)="start(provider)">
            Continue with {{ provider === 'google' ? 'Google' : 'GitHub' }}
          </button>
        }
      </div>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
  `,
  styles: ['.oauth-options { display: flex; flex-wrap: wrap; gap: 12px; margin-block: 20px; }'],
})
export class OAuthSignIn implements OnInit {
  readonly oauth = inject(OAuthService);
  readonly error = signal('');
  private readonly destroyRef = inject(DestroyRef);
  ngOnInit() {
    this.oauth.loadProviders().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  start(provider: OAuthProvider) {
    try {
      if (!this.oauth.start(provider))
        this.error.set('This sign-in method is currently unavailable.');
    } catch {
      this.error.set('The sign-in page could not be opened. Please try again.');
    }
  }
}
