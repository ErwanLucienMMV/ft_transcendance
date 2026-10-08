import { validateEnvironment } from './environment.js';

const valid = {
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'transcendence_test',
  DATABASE_USER: 'foundation_test',
  DATABASE_PASSWORD: 'test-only-password',
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
  ])('rejects missing %s without exposing another secret', (key) => {
    const input = { ...valid, [key]: '' };
    expect(() => validateEnvironment(input)).toThrow(key);
    expect(() => validateEnvironment(input)).not.toThrow(
      valid.DATABASE_PASSWORD,
    );
  });
});
