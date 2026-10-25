import { expect, test, type Page } from '@playwright/test';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

async function openScore(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset(name));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
}

test('編曲案を作り、割当表を直し、警告から小節へ移動できる。リロード後も残る', async ({ page }) => {
  test.setTimeout(120_000);
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  await page.getByRole('button', { name: '編曲', exact: true }).click();
  await page.getByRole('button', { name: '編曲案を作る' }).click();

  // 編曲で作った楽譜に切り替わる
  await expect(page.getByLabel('楽譜').locator('option:checked')).toHaveText('編曲：木管5重奏');
  await expect(page.getByLabel('表示するパート')).toContainText('フルート');
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();

  // 割当表：最初の区間のオーボエをチェロにする
  await page.getByRole('button', { name: '編曲', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編曲' });
  await expect(dialog.getByRole('table')).toBeVisible();
  const oboe = dialog.getByLabel(/小節からのオーボエ$/).first();
  await oboe.selectOption({ label: await oboe.locator('option', { hasText: 'Violoncello' }).first().innerText() });
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeEnabled();
  await dialog.getByRole('button', { name: '閉じる' }).click();

  // 警告の一覧から小節へ
  const chip = page.getByRole('button', { name: /^編曲の警告 \d+$/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await page.getByRole('dialog', { name: '編曲' }).locator('.issues .link').first().click();
  await expect(page.getByRole('dialog', { name: '編曲' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible(); // 小節が選ばれている

  // 手で直した音は色が付く
  const first = page.locator('section.chunk[data-start="0"]:not(.placeholder)');
  const id = (await first.locator('g.note').first().getAttribute('id'))!;
  await page.locator(`[id="${id}"] use`).first().dispatchEvent('click');
  await page.getByRole('button', { name: '8va↓' }).click();
  await expect(page.locator('.chunk svg .edited').first()).toBeAttached();

  // 保存されてから、リロードして続きを開く
  await expect(page.getByTestId('save-status')).toHaveText('端末に保存済み', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: '続きを開く' }).click();
  await expect(page.getByLabel('楽譜')).toContainText('編曲：木管5重奏');
  await page.getByLabel('楽譜').selectOption({ label: '編曲：木管5重奏' });
  await expect(page.locator('.chunk svg .edited').first()).toBeAttached();
});

test('大編成：合成オーケストラ（500小節）の編曲案の時間と、通し再生', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset('synthetic-orchestra-500.musicxml'));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '編曲', exact: true }).click();
  const t = Date.now();
  await page.getByRole('button', { name: '編曲案を作る' }).click();
  await expect(page.getByLabel('楽譜').locator('option:checked')).toHaveText('編曲：木管5重奏');
  const ms = Date.now() - t;
  console.log(`[${info.project.name}] 合成オーケストラ → 木管5重奏：${ms}ms`);
  // 目標は PC 3秒・スマホ 10秒（ここは同じ機械で画面の大きさを変えているだけ）
  expect(ms).toBeLessThan(info.project.name === 'pc' ? 3000 : 10000);

  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
  await page.getByRole('button', { name: '再生' }).click();
  await expect(page.locator('.play-cursor')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.playbar .position')).toHaveText(/^\d+ \/ 500小節$/);
  await page.getByRole('button', { name: '一時停止' }).click();
});
