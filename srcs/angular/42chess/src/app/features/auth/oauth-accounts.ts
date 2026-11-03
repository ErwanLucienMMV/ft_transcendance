import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import {
  OAUTH_LABELS,
  OAUTH_PROVIDERS,
  OAuthProvider,
  OAuthService,
} from '../../core/auth/oauth.service';
import { authFeedback } from './auth-feedback';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

@Component({
  selector: 'app-oauth-accounts',
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      <section class="card settings-section" aria-labelledby="sign-in-methods-title">
        <h2 id="sign-in-methods-title" class="section-title">
          {{ t('settings.methods.title') }}
        </h2>
        <p class="muted">{{ t('settings.methods.help') }}</p>
        @if (oauth.providers().length || linked().length) {
          <ul class="methods">
            @for (provider of allProviders; track provider) {
              @if (linked().includes(provider)) {
                <li>
                  <span
                    ><strong>{{ labels[provider] }}</strong>
                    <span class="badge on">{{ t('settings.methods.linked') }}</span></span
                  >
                  <button
                    type="button"
                    class="secondary small"
                    [disabled]="pending()"
                    (click)="unlink(provider)"
                  >
                    {{ t('settings.methods.unlink', { provider: labels[provider] }) }}
                  </button>
                </li>
              } @else if (oauth.providers().includes(provider)) {
                <li>
                  <span
                    ><strong>{{ labels[provider] }}</strong>
                    <span class="badge">{{ t('settings.methods.notLinked') }}</span></span
                  >
                  <button
                    type="button"
                    class="secondary small"
                    [disabled]="pending()"
                    (click)="link(provider)"
                  >
                    {{ t('settings.methods.link', { provider: labels[provider] }) }}
                  </button>
                </li>
              }
            }
          </ul>
        } @else {
          <p class="muted">{{ t('settings.methods.none') }}</p>
        }
        @if (error()) {
          <p class="field-error" role="alert">{{ error() }}</p>
        }
      </section>
    </ng-container>
  `,
})
export class OAuthAccounts implements OnInit {
  readonly oauth = inject(OAuthService);
  readonly linked = signal<OAuthProvider[]>([]);
  readonly allProviders = OAUTH_PROVIDERS;
  readonly labels = OAUTH_LABELS;
  readonly pending = signal(false);
  readonly error = signal('');
  private readonly destroyRef = inject(DestroyRef);
  ngOnInit() {
    this.oauth.loadProviders().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    this.oauth
      .accounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.linked.set(result.providers),
        error: (error) => this.error.set(authFeedback(error)),
      });
  }
  link(provider: OAuthProvider) {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    try {
      this.oauth
        .link(provider)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => this.pending.set(false)),
        )
        .subscribe({ error: (error) => this.error.set(authFeedback(error)) });
    } catch {
      this.pending.set(false);
      this.error.set(tr('settings.methods.unavailable'));
    }
  }
  unlink(provider: OAuthProvider) {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.oauth
      .unlink(provider)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => this.linked.update((items) => items.filter((item) => item !== provider)),
        error: (error) => this.error.set(authFeedback(error)),
      });
  }
}
