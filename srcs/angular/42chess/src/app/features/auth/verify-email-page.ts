import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ResendVerification } from './resend-verification';
import { authFeedback } from './auth-feedback';
import { AuthFrame } from '../../shared/auth-frame';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

@Component({
  selector: 'app-verify-email-page',
  imports: [TranslocoDirective, RouterLink, ResendVerification, AuthFrame],
  templateUrl: './verify-email-page.html',
})
export class VerifyEmailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly step = signal<'open' | 'checking' | 'done'>('open');
  private readonly failure = signal<unknown>(null);
  readonly verified = computed(() => this.step() === 'done');
  /** Follows the language, like every text on the page. */
  readonly message = computed(() =>
    this.failure() ? authFeedback(this.failure()) : tr(`auth.verify.${this.step()}`),
  );
  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) return;
    this.step.set('checking');
    this.auth
      .verifyEmail(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.step.set('done'),
        error: (error) => this.failure.set(error),
      });
  }
}
