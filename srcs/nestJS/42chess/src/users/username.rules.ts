import { ValidateBy } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/**
 * Names nobody can register, compared case-insensitively. They could be
 * mistaken for staff, system or bot accounts, or clash with UI wording
 * (the navbar shows "guest" for visitors) and route names.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'sysadmin',
  'moderator',
  'mod',
  'support',
  'staff',
  'official',
  'guest',
  'anonymous',
  'bot',
  'stockfish',
  'engine',
  'computer',
  'me',
  'null',
  'undefined',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}

/** class-validator rule: the value must not be a reserved username. */
export function IsNotReservedUsername(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotReservedUsername',
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || !isReservedUsername(value),
        defaultMessage: () => 'this username is reserved',
      },
    },
    options,
  );
}
