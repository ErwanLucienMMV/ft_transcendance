import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { authFeedback } from './auth-feedback';

@Component({
  selector: 'app-resend-verification',
  imports: [ReactiveFormsModule],
  template: `
    <details>
      <summary>Request another verification email</summary>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="pending()">
        <label for="resend-email">Verification email address</label>
        <input
          id="resend-email"
          type="email"
          autocomplete="email"
          formControlName="email"
          required
          maxlength="254"
        />
        @if (form.invalid && form.touched) {
          <p role="alert">Enter a valid email address.</p>
        }
        <button type="submit" [disabled]="pending()">Send verification email</button>
      </form>
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
    </details>
  `,
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
        next: () =>
          this.message.set('If this account needs verification, a new link has been sent.'),
        error: (error) => this.message.set(authFeedback(error)),
      });
  }
}
