import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4200', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start -- --host 0.0.0.0 --port 4200',
    env: { NG_ALLOWED_HOSTS: 'localhost,127.0.0.1' },
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
