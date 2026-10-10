import { ValidateBy } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { disposableEmailBlocklistSet } from 'disposable-email-domains-js';

// Built once: the library rebuilds its Set of ~5000 domains on every call.
const DISPOSABLE_DOMAINS: ReadonlySet<string> = disposableEmailBlocklistSet();

/**
 * True for throwaway inboxes (mailinator, yopmail...). Parent domains are
 * checked too, so "x@inbox.mailinator.com" is caught like "x@mailinator.com".
 */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  const labels = domain.split('.');

  for (let i = 0; i < labels.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join('.'))) {
      return true;
    }
  }
  return false;
}

/** class-validator rule: the value must not be a disposable email address. */
export function IsNotDisposableEmail(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotDisposableEmail',
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || !isDisposableEmail(value),
        defaultMessage: () => 'disposable email addresses are not allowed',
      },
    },
    options,
  );
}
