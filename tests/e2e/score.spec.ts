import { expect, test } from '@playwright/test';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

async function openScore(page: import('@playwright/test').Page, name: string) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset(name));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
}

test('楽譜を表示し、移調（記譜音）と実音を切り替えられる', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  const first = page.locator('section.chunk:not(.placeholder)').first();
  await expect(first.locator('g.note').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('k464.png') });
  await page.getByRole('radiogroup', { name: '音の高さ' }).getByText('実音').click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
});

test('オーケストラ（500小節）の最初の表示までの時間', async ({ page }) => {
  await page.goto('/');
  const t = Date.now();
  await page.getByLabel('楽譜ファイル').setInputFiles(asset('synthetic-orchestra-500.musicxml'));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible({ timeout: 30_000 });
  const ms = Date.now() - t;
  console.log(`[${test.info().project.name}] 合成オーケストラ：ファイル選択〜最初の楽譜表示 ${ms}ms`);
  await page.screenshot({ path: test.info().outputPath('orchestra.png') });
  const limit = test.info().project.name === 'pc' ? 5000 : 10000;
  expect(ms).toBeLessThan(limit);
});
