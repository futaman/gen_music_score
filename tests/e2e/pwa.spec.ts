import { expect, test } from '@playwright/test';

test('ホーム画面に追加できる（マニフェストと Service Worker）', async ({ page }) => {
  await page.goto('/');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await page.request.get(new URL(manifest!, page.url()).toString());
  expect((await res.json()).display).toBe('standalone');
  // Service Worker が動き始め、再読み込み後はページを管理している
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});
