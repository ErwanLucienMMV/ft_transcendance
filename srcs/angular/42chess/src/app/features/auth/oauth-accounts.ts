import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { OAuthProvider, OAuthService } from '../../core/auth/oauth.service';
import { authFeedback } from './auth-feedback';

@Component({
  selector: 'app-oauth-accounts',
  template: `
    @if (oauth.providers().length || linked().length) {
      <section aria-label="Linked sign-in methods">
        <h3>Sign-in methods</h3>
        @for (provider of allProviders; track provider) {
          @if (linked().includes(provider)) {
            <p>
              {{ provider === 'google' ? 'Google' : 'GitHub' }} is linked.
              <button
                type="button"
                class="button secondary"
                [disabled]="pending()"
                (click)="unlink(provider)"
              >
                Unlink {{ provider === 'google' ? 'Google' : 'GitHub' }}
              </button>
            </p>
          } @else if (oauth.providers().includes(provider)) {
            <p>
              <button
                type="button"
                class="button secondary"
                [disabled]="pending()"
                (click)="link(provider)"
              >
                Link {{ provider === 'google' ? 'Google' : 'GitHub' }}
              </button>
            </p>
          }
        }
      </section>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
  `,
})
export class OAuthAccounts implements OnInit {
  readonly oauth = inject(OAuthService);
  readonly linked = signal<OAuthProvider[]>([]);
  readonly allProviders: OAuthProvider[] = ['google', 'github'];
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
      this.error.set('This provider is currently unavailable.');
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
