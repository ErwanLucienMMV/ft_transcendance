import { Component, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { AUTH_FIELD_LIMITS, RegisterCredentials } from './auth-form.models';

const passwordsMatch: ValidatorFn = (group) =>
  group.get('password')?.value === group.get('confirmPassword')?.value
    ? null
    : { passwordMismatch: true };

@Component({
  selector: 'app-register-form',
  imports: [ReactiveFormsModule],
  templateUrl: './register-form.html',
})
export class RegisterForm {
  readonly submissionEnabled = input(false);
  readonly pending = input(false);
  readonly submitted = output<RegisterCredentials>();
  readonly limits = AUTH_FIELD_LIMITS;
  readonly form = inject(FormBuilder).nonNullable.group(
    {
      username: [
        '',
        [
          Validators.required,
          Validators.minLength(AUTH_FIELD_LIMITS.usernameMin),
          Validators.maxLength(AUTH_FIELD_LIMITS.usernameMax),
          Validators.pattern(/^[A-Za-z0-9_]+$/),
        ],
      ],
      email: [
        '',
        [Validators.required, Validators.email, Validators.maxLength(AUTH_FIELD_LIMITS.emailMax)],
      ],
      password: [
        '',
        [
          Validators.required,
          Validators.minLength(AUTH_FIELD_LIMITS.passwordMin),
          Validators.maxLength(AUTH_FIELD_LIMITS.passwordMax),
        ],
      ],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }

  passwordMismatch(): boolean {
    const control = this.form.controls.confirmPassword;
    return this.form.hasError('passwordMismatch') && (control.touched || control.dirty);
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (!this.submissionEnabled() || this.pending() || this.form.invalid) return;
    const { username, email, password } = this.form.getRawValue();
    this.submitted.emit({ username, email, password });
  }
}
