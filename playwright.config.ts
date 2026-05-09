import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const E2E_DATA = path.resolve('.e2e');
const E2E_DB = path.join(E2E_DATA, 'vtt.sqlite');
const E2E_UPLOADS = path.join(E2E_DATA, 'uploads');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --import tsx server/src/main.ts',
      env: {
        DB_PATH: E2E_DB,
        UPLOADS_DIR: E2E_UPLOADS,
        PORT: '3002',
        ENABLE_TEST_RESET: '1',
        APP_SECRET: 'e2e-secret-do-not-use-in-prod',
      },
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: false,
      timeout: 20_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:client',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 20_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
