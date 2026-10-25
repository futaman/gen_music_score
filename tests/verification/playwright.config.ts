import { defineConfig, devices } from '@playwright/test';

// 検証者の画面検証（docs/verification/spec.md の L4）。画面サイズは既存の playwright.config.ts と同じ
export default defineConfig({
  testDir: 'ui',
  timeout: 90_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: { env: { ...process.env, LANG: 'C.UTF-8' } },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    cwd: '../..',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  outputDir: '../../test-results/verification',
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
