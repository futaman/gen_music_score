import { expect, test, type Page } from '@playwright/test';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

async function openScore(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset(name));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
}

/** 最初の段の調号の記号の数 */
const keyAccidentals = (page: Page) =>
  page.locator('section.chunk:not(.placeholder)').first().locator('g.keySig').first().locator('g.keyAccid').count();

test('完了条件：イ長調の曲を B♭ へ移調し、B♭クラのパートを作ると Cメジャーで表示される', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  // 最初のチャンクは段の切れ目に合わせて描き直されることがあるので、落ち着くまで待つ
  await expect.poll(() => keyAccidentals(page)).toBe(3);

  // モードA：B♭メジャーへ（上げる）
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByLabel('移調先の調').selectOption({ label: 'B♭メジャー（♭2つ）' });
  await expect(page.getByTestId('transpose-preview')).toContainText('短2度上');
  await page.getByRole('button', { name: '移調する' }).click();
  await expect(page.getByRole('status')).toContainText('移調しました');
  await expect.poll(() => keyAccidentals(page)).toBe(2);

  // モードB：第1ヴァイオリンから B♭クラリネットのパートを作る
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByLabel('元のパート').selectOption({ label: 'Violin 1' });
  await page.getByLabel('楽器').selectOption({ label: 'クラリネット（B♭管）' });
  await page.getByRole('button', { name: 'パートを作る' }).click();
  await expect(page.getByLabel('表示するパート')).toHaveValue(/.+/);
  await expect(page.getByLabel('表示するパート').locator('option:checked')).toHaveText('クラリネット（B♭管）');
  await expect.poll(() => keyAccidentals(page)).toBe(0);

  // 実音にすると B♭メジャー（♭2つ）
  await page.getByRole('radiogroup', { name: '音の高さ' }).getByText('実音').click();
  await expect.poll(() => keyAccidentals(page)).toBe(2);
});

test('音域外の音を赤く表示し、候補どおりに直せる', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  // チェロのパートをフルートにすると、低すぎる音がたくさん出る
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByLabel('元のパート').selectOption({ label: 'Violoncello' });
  await page.getByLabel('楽器').selectOption({ label: 'フルート' });
  await page.getByRole('button', { name: 'パートを作る' }).click();
  const chip = page.getByRole('button', { name: /^音域外 \d+$/ });
  await expect(chip).toBeVisible();
  const before = Number((await chip.textContent())!.replace(/\D/g, ''));
  await chip.click();
  await page.getByRole('button', { name: /このパートの\d+音を候補どおりに直す/ }).click();
  await expect(page.getByRole('status')).toContainText('オクターブを動かしました');
  await expect
    .poll(async () =>
      Number(((await chip.textContent({ timeout: 1000 }).catch(() => '0')) ?? '0').replace(/\D/g, '') || 0),
    )
    .toBeLessThan(before);
});

test('音程は「種類 × 度数＋オクターブ」で指定できる（増2度、長9度など）', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByText('音程を指定').click();
  await page.getByLabel('度数').selectOption('2');
  await page.getByLabel('音程の種類').selectOption({ label: '増' });
  await expect(page.getByTestId('transpose-preview')).toContainText('増2度上');
  await page.getByLabel('音程の種類').selectOption({ label: '長' });
  await page.getByLabel('足すオクターブ').selectOption({ label: '1オクターブ' });
  await expect(page.getByTestId('transpose-preview')).toContainText('長9度上');
  // 完全系の度数にすると、種類は「完全」に変わる
  await page.getByLabel('度数').selectOption('5');
  await expect(page.getByLabel('音程の種類')).toHaveValue('P');
  await page.getByRole('button', { name: '移調する' }).click();
  await expect(page.getByRole('status')).toContainText('移調しました');
});
