import { defineConfig } from '@playwright/test';

const externalURL = process.env.TEST_URL;
const baseURL = externalURL || 'http://127.0.0.1:4173/games/flying-dragon/';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {},
  },
  webServer: externalURL ? undefined : {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort --base /games/flying-dragon/',
    url: baseURL,
    reuseExistingServer: false,
  },
});
