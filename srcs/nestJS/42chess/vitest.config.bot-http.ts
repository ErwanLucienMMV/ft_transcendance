import { defineConfig } from 'vitest/config';
// Run the real controller HTTP contract without requiring a local PostgreSQL.
export default defineConfig({
  test: { globals: true, include: ['test/bot-controller.e2e-spec.ts'] },
});
