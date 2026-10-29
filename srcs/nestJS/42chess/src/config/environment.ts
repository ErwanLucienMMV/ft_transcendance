import { resolve } from 'node:path';
import type { ConfigModuleOptions } from '@nestjs/config';

/** What the TypeORM CLI needs: migrations must not require app secrets. */
export interface DatabaseEnvironment {
  APIPORT: number;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_NAME: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
}

export interface Environment extends DatabaseEnvironment {
  CORS_ORIGINS?: string;
  JWT_SECRET: string;
  /** Access token lifetime, in seconds. */
  JWT_EXPIRES_IN: number;
  /** Session lifetime behind the refresh cookie, in seconds; renewed on each refresh. */
  REFRESH_EXPIRES_IN: number;
}

// HS256 key: shorter secrets can be brute-forced offline from any token.
const JWT_SECRET_MIN_LENGTH = 32;
const DEFAULT_JWT_EXPIRES_IN = 3600;
export const DEFAULT_REFRESH_EXPIRES_IN = 7 * 24 * 3600;

function required(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Configuration: ${name} must be a non-empty string`);
  }
  return value;
}

function port(name: string, value: unknown): number {
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`Configuration: ${name} must be an integer port (1-65535)`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Configuration: ${name} must be an integer port (1-65535)`);
  }
  return parsed;
}

function secret(input: Record<string, unknown>, name: string): string {
  const value = required(input, name);
  if (value.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `Configuration: ${name} must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
    );
  }
  return value;
}

function seconds(name: string, value: unknown): number {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw new Error(
      `Configuration: ${name} must be a positive number of seconds`,
    );
  }
  return Number(value);
}

export function validateDatabaseEnvironment(
  input: Record<string, unknown>,
): DatabaseEnvironment {
  return {
    ...input,
    APIPORT: port('APIPORT', input.APIPORT ?? input.PORT ?? 3000),
    DATABASE_HOST: required(input, 'DATABASE_HOST'),
    DATABASE_PORT: port('DATABASE_PORT', input.DATABASE_PORT ?? 5432),
    DATABASE_NAME: required(input, 'DATABASE_NAME'),
    DATABASE_USER: required(input, 'DATABASE_USER'),
    DATABASE_PASSWORD: required(input, 'DATABASE_PASSWORD'),
  };
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  return {
    ...validateDatabaseEnvironment(input),
    JWT_SECRET: secret(input, 'JWT_SECRET'),
    JWT_EXPIRES_IN: seconds(
      'JWT_EXPIRES_IN',
      input.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES_IN,
    ),
    REFRESH_EXPIRES_IN: seconds(
      'REFRESH_EXPIRES_IN',
      input.REFRESH_EXPIRES_IN ?? DEFAULT_REFRESH_EXPIRES_IN,
    ),
  };
}

// Process environment takes precedence, then local .env, then srcs/.env.
// The latter supports running npm commands from srcs/nestJS/42chess on the host.
export const configurationOptions: ConfigModuleOptions = {
  isGlobal: true,
  cache: true,
  envFilePath: [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ],
  validate: validateEnvironment,
};
