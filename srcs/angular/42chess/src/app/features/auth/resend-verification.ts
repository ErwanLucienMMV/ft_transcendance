import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { authFeedback } from './auth-feedback';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

@Component({
  selector: 'app-resend-verification',
  imports: [TranslocoDirective, ReactiveFormsModule],
  templateUrl: './resend-verification.html',
})
export class ResendVerification {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
  });
  readonly pending = signal(false);
  readonly message = signal('');
  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.pending()) return;
    this.pending.set(true);
    this.message.set('');
    this.auth
      .resendVerification(this.form.getRawValue().email)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => this.message.set(tr('auth.resend.sent')),
        error: (error) => this.message.set(authFeedback(error)),
      });
  }
}
