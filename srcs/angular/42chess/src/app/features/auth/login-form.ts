import { Component, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AUTH_FIELD_LIMITS, backendLengthValidator, LoginCredentials } from './auth-form.models';

@Component({
  selector: 'app-login-form',
  imports: [ReactiveFormsModule],
  templateUrl: './login-form.html',
})
export class LoginForm {
  readonly submissionEnabled = input(false);
  readonly pending = input(false);
  readonly submitted = output<LoginCredentials>();
  readonly limits = AUTH_FIELD_LIMITS;
  readonly form = inject(FormBuilder).nonNullable.group({
    login: ['', [Validators.required, Validators.maxLength(AUTH_FIELD_LIMITS.emailMax)]],
    // Login must accept existing passwords; registration strength rules do not apply here.
    password: ['', [Validators.required, backendLengthValidator(1, AUTH_FIELD_LIMITS.passwordMax)]],
  });

  invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (!this.submissionEnabled() || this.pending() || this.form.invalid) return;
    this.submitted.emit(this.form.getRawValue());
  }
}
