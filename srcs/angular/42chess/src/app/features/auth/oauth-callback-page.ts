import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OAuthService } from '../../core/auth/oauth.service';
import { AuthService } from '../../core/auth/auth.service';
import { AuthFrame } from '../../shared/auth-frame';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

@Component({
  selector: 'app-oauth-callback-page',
  imports: [TranslocoDirective, AuthFrame, RouterLink],
  template: `
    <ng-container *transloco="let t">
      <app-auth-frame>
        <h1>{{ t('auth.oauth.title') }}</h1>
        @if (error()) {
          <p role="alert">{{ error() }}</p>
          <a class="button secondary" routerLink="/login">{{ t('auth.oauth.back') }}</a>
        } @else {
          <p role="status">{{ t('auth.oauth.checking') }}</p>
        }
      </app-auth-frame>
    </ng-container>
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
        tr(error === 'existing-account' ? 'auth.oauth.existing' : 'auth.oauth.cancelled'),
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
        error: () => this.error.set(tr('auth.oauth.failed')),
      });
  }
}
