import { validateEnvironment } from './environment.js';

const valid = {
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'transcendence_test',
  DATABASE_USER: 'foundation_test',
  DATABASE_PASSWORD: 'test-only-password',
  JWT_SECRET: 'test-only-jwt-secret-of-32-chars!',
};

describe('Environment validation', () => {
  it('converts ports and supports the existing PORT fallback', () => {
    expect(
      validateEnvironment({ ...valid, PORT: '3100', DATABASE_PORT: '55432' }),
    ).toMatchObject({ APIPORT: 3100, DATABASE_PORT: 55432 });
    expect(
      validateEnvironment({ ...valid, PORT: '3100', APIPORT: '3200' }).APIPORT,
    ).toBe(3200);
  });

  it.each(['', '0', '65536', '3.5', '3000abc', '-1'])(
    'rejects invalid port %j',
    (port) => {
      expect(() =>
        validateEnvironment({ ...valid, DATABASE_PORT: port }),
      ).toThrow('DATABASE_PORT');
    },
  );

  it.each([
    'DATABASE_HOST',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
    'JWT_SECRET',
  ])('rejects missing %s without exposing another secret', (key) => {
    const input = { ...valid, [key]: '' };
    expect(() => validateEnvironment(input)).toThrow(key);
    expect(() => validateEnvironment(input)).not.toThrow(
      valid.DATABASE_PASSWORD,
    );
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() =>
      validateEnvironment({ ...valid, JWT_SECRET: 'too-short' }),
    ).toThrow('JWT_SECRET must be at least 32 characters');
  });

  it('defaults the token lifetime to one hour', () => {
    expect(validateEnvironment(valid).JWT_EXPIRES_IN).toBe(3600);
    expect(
      validateEnvironment({ ...valid, JWT_EXPIRES_IN: '900' }).JWT_EXPIRES_IN,
    ).toBe(900);
  });

  it.each(['', '0', '-60', '1h', '3.5'])(
    'rejects invalid token lifetime %j',
    (lifetime) => {
      expect(() =>
        validateEnvironment({ ...valid, JWT_EXPIRES_IN: lifetime }),
      ).toThrow('JWT_EXPIRES_IN');
    },
  );

  it('defaults the refresh session lifetime to seven days', () => {
    expect(validateEnvironment(valid).REFRESH_EXPIRES_IN).toBe(604800);
    expect(
      validateEnvironment({ ...valid, REFRESH_EXPIRES_IN: '86400' })
        .REFRESH_EXPIRES_IN,
    ).toBe(86400);
    expect(() =>
      validateEnvironment({ ...valid, REFRESH_EXPIRES_IN: '7d' }),
    ).toThrow('REFRESH_EXPIRES_IN');
  });
});
