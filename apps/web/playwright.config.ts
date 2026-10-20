import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Browser tests of the operations console against the real API and a throwaway database.
 * Needs E2E_DATABASE_URL and both apps built (`pnpm build`). The database is wiped.
 */
const API_PORT = 4100;
const WEB_PORT = 3100;
export const OTP_OUTBOX = path.resolve(import.meta.dirname, 'test-results', 'otp-outbox.txt');
const databaseUrl = process.env.E2E_DATABASE_URL ?? '';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/v1/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        API_PORT: String(API_PORT),
        AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-0000',
        OTP_SENDER: 'file',
        OTP_OUTBOX_FILE: OTP_OUTBOX,
      },
    },
    {
      command: `npx next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
