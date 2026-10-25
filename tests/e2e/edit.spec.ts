import { expect, test, type Page } from '@playwright/test';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

async function openScore(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset(name));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await page.getByLabel('表示するパート').selectOption({ index: 1 }); // 第1ヴァイオリンだけ
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
}

/**
 * 曲の頭のチャンクの n 番目の音（g.note）をタップして選ぶ。
 * チャンクは順不同に描き上がるので、「曲の頭」のチャンクで、id を決めてからその音をタップする。
 */
async function tapNote(page: Page, n: number) {
  const first = page.locator('section.chunk[data-start="0"]:not(.placeholder)');
  await expect(first.locator('g.note').nth(n)).toBeVisible();
  const id = (await first.locator('g.note').nth(n).getAttribute('id'))!;
  const note = page.locator(`[id="${id}"]`);
  await note.locator('use').first().dispatchEvent('click');
  return note;
}

/** 音の高さ（五線のいちばん上の線からの距離。段が上下に動いても変わらない） */
const noteY = (page: Page, id: string) =>
  page
    .locator(`[id="${id}"] use`)
    .first()
    .evaluate((el) => {
      const staff = el.closest('g.staff')!.querySelector(':scope > path')!;
      return el.getBoundingClientRect().y - staff.getBoundingClientRect().y;
    });

test('音符を選んで音高を変え、元に戻す・やり直す', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  const note = await tapNote(page, 2);
  const id = (await note.getAttribute('id'))!;
  await expect(page.getByRole('toolbar', { name: '編集' })).toBeVisible();
  const y0 = await noteY(page, id);
  await page.getByRole('button', { name: '8va↑' }).click();
  await expect.poll(() => noteY(page, id)).toBeLessThan(y0 - 10);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect.poll(() => noteY(page, id)).toBeCloseTo(y0, 0);
  await page.getByRole('button', { name: 'やり直し' }).click();
  await expect.poll(() => noteY(page, id)).toBeLessThan(y0 - 10);
});

test('キーボード：音名で入力して次へ進み、数字で音価、Delete で休符', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'キーボード操作は PC のみ');
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  const note = await tapNote(page, 2);
  const id = (await note.getAttribute('id'))!;
  await page.keyboard.press('c');
  // 選択が次の音へ進む
  await expect(page.locator('.chunk svg .sel')).not.toHaveAttribute('id', id);
  await page.keyboard.press('Control+z');
  await expect(page.locator(`[id="${id}"]`)).toBeAttached();
  await tapNote(page, 2);
  await page.keyboard.press('6'); // 2分音符
  await expect(page.getByRole('status'))
    .toBeHidden({ timeout: 1000 })
    .catch(() => {});
  await page.keyboard.press('Delete');
  await expect(page.locator(`[id="${id}"]`)).toHaveCount(0);
});

test('鍵盤パネルで入力（タッチ端末向け）', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  await tapNote(page, 1);
  await page.getByRole('button', { name: '鍵盤' }).click();
  await expect(page.getByRole('group', { name: '鍵盤' })).toBeVisible();
  const before = await page.locator('.chunk svg .sel').getAttribute('id');
  await page.getByRole('button', { name: 'ソ4', exact: true }).click();
  await expect.poll(() => page.locator('.chunk svg .sel').getAttribute('id')).not.toBe(before);
});

test('小節を範囲で選び、コピーして貼り付ける', async ({ page }) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  // 小節index 2 の五線（音のないところ）をタップすると、その小節を範囲で選ぶ
  await page.locator('[id^="s2-"]').first().locator('path').first().dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await page.getByRole('button', { name: 'コピー' }).click();
  await expect(page.getByRole('status')).toContainText('1小節をコピーしました');
  await page.locator('[id^="s5-"]').first().locator('path').first().dispatchEvent('click');
  await page.getByRole('button', { name: '貼り付け' }).click();
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeEnabled();
});

test('編集が画面に出るまでの時間（目標：PC 0.2秒・スマホ 0.3秒）', async ({ page }, info) => {
  await openScore(page, 'mozart-k464-1-allegro.mxl');
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const note = await tapNote(page, 2 + i);
    const id = (await note.getAttribute('id'))!;
    await expect(page.getByRole('toolbar', { name: '編集' })).toBeVisible();
    // ボタンを押してから、その音の位置が変わった最初の描画までを、ページの中で測る
    const ms = await page.evaluate(
      (id) =>
        new Promise<number>((resolve) => {
          const y = () => document.querySelector(`[id="${id}"] use`)?.getBoundingClientRect().y;
          const y0 = y();
          const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '8va↑')!;
          const t0 = performance.now();
          button.click();
          const check = () => {
            const v = y();
            if (v !== undefined && y0 !== undefined && Math.abs(v - y0) > 5) resolve(performance.now() - t0);
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }),
      id,
    );
    times.push(Math.round(ms));
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  info.annotations.push({ type: '編集反映（ミリ秒）', description: `中央値 ${median}（${times.join(', ')}）` });
  console.log(`[${info.project.name}] 編集反映 中央値 ${median}ms（${times.join(', ')}）`);
  // CI の機械は遅いことがあるので、ここでは大きく外れていないことだけ確かめる
  expect(median).toBeLessThan(1000);
});
