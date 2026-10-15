import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    setupFiles: ['./test/vitest.setup.ts'],
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      DATABASE_HOST: 'localhost',
      DATABASE_NAME: 'unit_test',
      DATABASE_USER: 'unit_test',
      DATABASE_PASSWORD: 'unit_test',
    },
  },
});
