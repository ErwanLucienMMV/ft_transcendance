import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OAuthService } from '../../core/auth/oauth.service';
import { AuthService } from '../../core/auth/auth.service';
import { AuthFrame } from '../../shared/auth-frame';

@Component({
  selector: 'app-oauth-callback-page',
  imports: [AuthFrame, RouterLink],
  template: `
    <app-auth-frame>
      <h1>Completing sign-in</h1>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
        <a class="button secondary" routerLink="/login">Return to sign in</a>
      } @else {
        <p role="status">Checking your sign-in…</p>
      }
    </app-auth-frame>
  `,
})
export class OAuthCallbackPage implements OnInit {
  readonly error = signal('');
  private readonly oauth = inject(OAuthService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  ngOnInit(): void {
    const error = this.route.snapshot.queryParamMap.get('error');
    if (error) {
      this.error.set(
        error === 'existing-account'
          ? 'An account already uses this email. Sign in normally, then link this provider from your settings.'
          : 'External sign-in was cancelled or expired. Please try again.',
      );
      return;
    }
    this.oauth
      .exchange()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) =>
          void this.router.navigateByUrl(
            this.auth.needsTwoFactor()
              ? '/two-factor'
              : 'newAccount' in response && response.newAccount
                ? '/settings?welcome=1'
                : '/session',
            { replaceUrl: true },
          ),
        error: () =>
          this.error.set('This sign-in expired or could not be verified. Please start again.'),
      });
  }
}
