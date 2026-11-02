import { ValidateBy, buildMessage } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import type { TimeControl } from './clock/game-clock.js';

/**
 * The time controls a player can pick, in milliseconds. The front offers the same
 * list (features/game/games-api.ts); the HTTP API refuses anything else.
 */
export const TIME_CONTROLS: readonly TimeControl[] = [
  { initialTime: 180_000, increment: 2_000 },
  { initialTime: 300_000, increment: 0 },
  { initialTime: 600_000, increment: 0 },
  { initialTime: 900_000, increment: 10_000 },
  { initialTime: 1_800_000, increment: 0 },
];

export function isAllowedTimeControl(value: unknown): value is TimeControl {
  if (!value || typeof value !== 'object') return false;
  const { initialTime, increment } = value as Record<string, unknown>;
  return TIME_CONTROLS.some(
    (control) =>
      control.initialTime === initialTime && control.increment === increment,
  );
}

/** Applied next to the nested TimeControlDto checks, on the parent property. */
export function IsAllowedTimeControl(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAllowedTimeControl',
      validator: {
        validate: (value: unknown) => isAllowedTimeControl(value),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be one of the offered time controls: ${TIME_CONTROLS.map(
              (control) =>
                `${control.initialTime / 60_000}+${control.increment / 1000}`,
            ).join(', ')}`,
          options,
        ),
      },
    },
    options,
  );
}
