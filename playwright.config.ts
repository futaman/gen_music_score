import { defineConfig, devices } from '@playwright/test';

// 画面テスト。PC・タブレット・スマホの画面サイズで同じ操作が通ることを確かめる（実機確認の代わりではない）
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // 言語設定のない環境だと、日本語のファイル名のダウンロードが「download」になるため
    launchOptions: { env: { ...process.env, LANG: 'C.UTF-8' } },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
