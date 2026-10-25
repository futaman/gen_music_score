import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

async function openScore(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset(name));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await page.getByLabel('表示するパート').selectOption({ index: 1 }); // 第1ヴァイオリンだけ
  await expect(page.locator('section.chunk[data-start="0"]:not(.placeholder) g.note').first()).toBeVisible();
}

/** 曲の頭の n 番目の音をタップして、その id を返す */
async function tapNote(page: Page, n: number) {
  const first = page.locator('section.chunk[data-start="0"]:not(.placeholder)');
  await expect(first.locator('g.note').nth(n)).toBeVisible();
  const id = (await first.locator('g.note').nth(n).getAttribute('id'))!;
  await page.locator(`[id="${id}"] use`).first().dispatchEvent('click');
  return id;
}

const noteY = (page: Page, id: string) =>
  page
    .locator(`[id="${id}"] use`)
    .first()
    .evaluate((el) => {
      const staff = el.closest('g.staff')!.querySelector(':scope > path')!;
      return el.getBoundingClientRect().y - staff.getBoundingClientRect().y;
    });

test('編集は端末に自動保存され、リロード後に「続きを開く」で戻る', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  const id = await tapNote(page, 2);
  const y0 = await noteY(page, id);
  await page.getByRole('button', { name: '8va↑' }).click();
  const status = page.getByTestId('save-status');
  await expect(status).toHaveText('端末に保存済み', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: '続きを開く' }).click();
  await expect(page.locator(`[id="${id}"]`)).toBeVisible();
  expect(await noteY(page, id)).toBeLessThan(y0 - 10);
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled();
});

test('ホームの一覧から開く・削除する。閉じたあとは復元を尋ねない', async ({ page }) => {
  await openScore(page, 'mozart-k387.mxl');
  await page.getByRole('button', { name: '戻る' }).click();
  const item = page.getByRole('region', { name: 'プロジェクト' }).getByRole('listitem');
  await expect(item).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: '続きを開く' })).toHaveCount(0);
  await item.getByRole('button').first().click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
  await page.getByRole('button', { name: '戻る' }).click();
  page.once('dialog', (d) => void d.accept());
  await item.getByRole('button', { name: /を削除$/ }).click();
  await expect(item).toHaveCount(0);
});

test('プロジェクトをファイルに保存し、そのファイルから開く', async ({ page }, info) => {
  await openScore(page, 'mozart-k387.mxl');
  await tapNote(page, 1);
  await page.getByRole('button', { name: '休符' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'プロジェクトをファイルに保存' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.gakufu\.json$/);
  const path = info.outputPath('project.gakufu.json');
  await file.saveAs(path);
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: '戻る' }).click();
  await page.getByLabel('楽譜ファイル').setInputFiles({
    name: file.suggestedFilename(),
    mimeType: 'application/json',
    buffer: readFileSync(path),
  });
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
  await page.getByRole('button', { name: '戻る' }).click();
  await expect(page.getByRole('region', { name: 'プロジェクト' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText(/（ファイルから）/)).toBeVisible();
});
