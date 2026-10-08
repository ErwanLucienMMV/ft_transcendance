import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.integration-spec.ts'],
    setupFiles: ['./test/database.setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
