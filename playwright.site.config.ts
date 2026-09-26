import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/site',
  outputDir: './test-results/site',
  fullyParallel: true,
  workers: 3,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'npm run preview:site -- --port 4187', url: 'http://127.0.0.1:4187', reuseExistingServer: false },
});
