import { ValidatorFn } from '@angular/forms';

/** Field limits mirror the existing NestJS login/register DTOs. */
export const AUTH_FIELD_LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  emailMax: 254,
  passwordMin: 8,
  passwordMax: 128,
} as const;

/**
 * Counts characters like the backend's class-validator `@Length` (validator.js `isLength`):
 * a surrogate pair, or a character followed by a variation selector, counts once.
 */
export function backendLength(value: string): number {
  const presentationSequences = value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? [];
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  return value.length - presentationSequences.length - surrogatePairs.length;
}

/** Length bounds counted with {@link backendLength}; empty values are left to `required`. */
export function backendLengthValidator(min: number, max: number): ValidatorFn {
  return (control) => {
    const value: unknown = control.value;
    if (typeof value !== 'string' || value === '') return null;
    const actualLength = backendLength(value);
    if (actualLength < min) return { minlength: { requiredLength: min, actualLength } };
    if (actualLength > max) return { maxlength: { requiredLength: max, actualLength } };
    return null;
  };
}

export interface LoginCredentials {
  login: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  email: string;
  password: string;
}
