import { Component, inject, signal } from '@angular/core';
import { OAuthProvider, OAuthService } from '../../core/auth/oauth.service';

@Component({
  selector: 'app-oauth-sign-in',
  template: `
    @if (oauth.available('google') || oauth.available('github')) {
      <section class="oauth-options" aria-label="Alternative sign-in">
        <span class="divider">Or continue with</span>
        @if (oauth.available('google')) {
          <button type="button" (click)="start('google')">Continue with Google</button>
        }
        @if (oauth.available('github')) {
          <button type="button" (click)="start('github')">Continue with GitHub</button>
        }
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
      </section>
    }
  `,
})
export class OAuthSignIn {
  readonly oauth = inject(OAuthService);
  readonly error = signal('');
  start(provider: OAuthProvider): void {
    this.error.set(
      this.oauth.start(provider)
        ? ''
        : 'Social sign-in could not be opened. You can sign in with your password.',
    );
  }
}
