import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

async function openScore(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset(name));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
}

/** 書き出し画面で PDF を作り、中身（文字列）とファイル名を返す */
async function makePdf(page: Page, kind: 'パート譜' | '総譜' = 'パート譜', uncheck: string[] = []) {
  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('radiogroup', { name: '内容' }).getByText(kind).click();
  for (const name of uncheck) await page.getByRole('checkbox', { name }).uncheck();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'PDFを作る' }).click();
  const file = await download;
  const path = test.info().outputPath(`${Date.now()}.pdf`);
  await file.saveAs(path);
  await page.getByRole('button', { name: '閉じる' }).click();
  return { name: file.suggestedFilename(), text: readFileSync(path).toString('latin1') };
}

const pages = (pdf: string) => (pdf.match(/\/Type \/Page\b/g) ?? []).length;
/** 作った日時とファイルの ID を除く（同じ楽譜なら同じになるはずの部分） */
const stable = (pdf: string) => pdf.replace(/\/CreationDate \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');

test('パート譜の PDF：パートごとにページが分かれ、画面の大きさに左右されない', async ({ page }) => {
  test.setTimeout(120_000);
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  const a = await makePdf(page);
  expect(a.name).toMatch(/-パート譜\.pdf$/);
  expect(a.text.startsWith('%PDF-')).toBe(true);
  expect(pages(a.text)).toBeGreaterThanOrEqual(4); // 4パート × 1ページ以上
  // 日本語の文字がなければ日本語フォントは入れない
  expect(a.text).not.toContain('BIZUDPMincho');

  // 画面の大きさを変えても同じ PDF（PC とスマホで同じ見た目）
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width > 600 ? 390 : 1280, height: 800 });
  const b = await makePdf(page);
  expect(stable(b.text)).toBe(stable(a.text));
});

test('日本語のパート名は日本語フォントを埋め込んで書く。総譜も作れる', async ({ page }) => {
  test.setTimeout(120_000);
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByLabel('元のパート').selectOption({ label: 'Violin 1' });
  await page.getByLabel('楽器').selectOption({ label: 'クラリネット（B♭管）' });
  await page.getByRole('button', { name: 'パートを作る' }).click();
  await expect(page.getByLabel('表示するパート').locator('option:checked')).toHaveText('クラリネット（B♭管）');

  // クラリネットだけにする
  const clar = await makePdf(page, 'パート譜', ['Violin 1', 'Violin 2', 'Viola', 'Violoncello']);
  expect(clar.name).toMatch(/-クラリネット（B♭管）\.pdf$/);
  expect(clar.text).toContain('BIZUDPMincho');

  const full = await makePdf(page, '総譜');
  expect(pages(full.text)).toBeGreaterThanOrEqual(1);
});
