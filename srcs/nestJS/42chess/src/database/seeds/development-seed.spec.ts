import { assertDevelopmentSeed } from './development-seed.js';

describe('development seed opt-in', () => {
  it.each([
    {},
    {
      NODE_ENV: 'production',
      ALLOW_DEV_SEED: 'yes',
      DEV_SEED_PASSWORD: 'long-password',
    },
    { NODE_ENV: 'development', DEV_SEED_PASSWORD: 'long-password' },
    {
      NODE_ENV: 'development',
      ALLOW_DEV_SEED: 'yes',
      DEV_SEED_PASSWORD: 'short',
    },
  ])('rejects unsafe or incomplete environment %j', (env) => {
    expect(() => assertDevelopmentSeed(env)).toThrow();
  });
  it('accepts explicit development environment and a supplied password', () => {
    expect(() =>
      assertDevelopmentSeed({
        NODE_ENV: 'development',
        ALLOW_DEV_SEED: 'yes',
        DEV_SEED_PASSWORD: 'local-password-only',
      }),
    ).not.toThrow();
  });
});
