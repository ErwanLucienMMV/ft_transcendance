import { resolve } from 'node:path';
import type { ConfigModuleOptions } from '@nestjs/config';

export interface Environment {
  APIPORT: number;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_NAME: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  function required(name: string): string {
    const value = input[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Configuration: ${name} must be a non-empty string`);
    }
    return value;
  }

  function port(name: string, value: unknown): number {
    if (!/^\d+$/.test(String(value))) {
      throw new Error(
        `Configuration: ${name} must be an integer port (1-65535)`,
      );
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(
        `Configuration: ${name} must be an integer port (1-65535)`,
      );
    }
    return parsed;
  }

  return {
    ...input,
    APIPORT: port('APIPORT', input.APIPORT ?? input.PORT ?? 3000),
    DATABASE_HOST: required('DATABASE_HOST'),
    DATABASE_PORT: port('DATABASE_PORT', input.DATABASE_PORT ?? 5432),
    DATABASE_NAME: required('DATABASE_NAME'),
    DATABASE_USER: required('DATABASE_USER'),
    DATABASE_PASSWORD: required('DATABASE_PASSWORD'),
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
