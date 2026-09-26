import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  fullyParallel: true,
  workers: 3,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
    { command: 'npm run dev:server', url: 'http://127.0.0.1:5193/v1/decide', reuseExistingServer: false },
    { command: 'npm run preview:next', url: 'http://127.0.0.1:5184', reuseExistingServer: false },
    { command: 'npm run preview:distribution', url: 'http://127.0.0.1:5185/es/', reuseExistingServer: false },
  ],
});
