// 検証者の画面検証（L4）。項目は docs/verification/spec.md の ID。期待値は docs/spec.md から決めている。

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const assetPath = (name: string) => new URL(`../../../test-assets/musicxml/${name}`, import.meta.url).pathname;

/** ページのエラー（例外・console.error）を集める */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function openFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(typeof file === 'string' ? assetPath(file) : file);
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
}

/** 曲の頭のチャンクの n 番目の音を選ぶ（既存の画面テストと同じやり方） */
async function tapNote(page: Page, n: number) {
  const first = page.locator('section.chunk[data-start="0"]:not(.placeholder)');
  await expect(first.locator('g.note').nth(n)).toBeVisible();
  const id = (await first.locator('g.note').nth(n).getAttribute('id'))!;
  await page.locator(`[id="${id}"]`).locator('use').first().dispatchEvent('click');
  await expect(page.getByRole('toolbar', { name: '編集' })).toBeVisible();
  return id;
}

/** 見えている操作部品のうち、44px に満たないもの */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>(
      'button, select, a[href], input:not([type=hidden]), [role=radio], .segmented label, summary',
    );
    for (const el of Array.from(els)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      // ラジオ・チェックボックスはラベルごと押せるので、ラベルの大きさで見る
      if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type) && el.closest('label')) continue;
      // 文中のリンクは対象外
      if (el.tagName === 'A' && el.closest('p, li')) continue;
      if (Math.round(r.height) < 44 || Math.round(r.width) < 44) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 20);
        out.push(`${el.tagName.toLowerCase()}「${name}」${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return [...new Set(out)];
  });
}

/** ページ全体が横にはみ出していないか */
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);

/** ツールバー（上の帯）の部品で、画面の右端からはみ出して押せないもの */
const clippedToolbarItems = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.toolbar');
    if (!bar) return ['(toolbar なし)'];
    return Array.from(bar.querySelectorAll<HTMLElement>('button, select, .segmented'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
      })
      .map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 12));
  });

// ---------------------------------------------------------------- 端末・画面

test('UI-01 タッチ端末では、見えている操作部品が44px以上', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'タッチ端末（タブレット・スマホ）だけ');
  const found: Record<string, string[]> = {};
  await page.goto('/');
  found['ホーム'] = await smallTargets(page);
  await page.getByLabel('楽譜ファイル').setInputFiles(assetPath('mozart-k464-1-allegro.mxl'));
  found['読み込み確認'] = await smallTargets(page);
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
  found['楽譜'] = await smallTargets(page);
  await page.getByLabel('表示するパート').selectOption({ index: 1 });
  await tapNote(page, 2);
  found['楽譜＋編集バー'] = await smallTargets(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '移調', exact: true }).click();
  found['移調パネル'] = await smallTargets(page);
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  found['設定パネル'] = await smallTargets(page);
  const small = Object.entries(found).filter(([, v]) => v.length);
  await info.attach('44px未満の部品', { body: JSON.stringify(Object.fromEntries(small), null, 2) });
  console.log(`[${info.project.name}] UI-01 44px未満：${JSON.stringify(Object.fromEntries(small))}`);
  expect(small).toEqual([]);
});

test('UI-02 再生バーは画面下に固定され、スクロールしても動かない', async ({ page }) => {
  await openFile(page, 'mozart-k464-1-allegro.mxl');
  const bar = page.getByRole('toolbar', { name: '再生' });
  const vh = page.viewportSize()!.height;
  const before = (await bar.boundingBox())!;
  expect(Math.abs(before.y + before.height - vh)).toBeLessThanOrEqual(1);
  await page.mouse.wheel(0, 3000);
  await page.evaluate(() => window.scrollBy(0, 3000));
  await page.waitForTimeout(300);
  const after = (await bar.boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 0);
});

test('UI-03 横にはみ出さない（ページ全体の横スクロールがなく、上のツールバーの部品が画面内にある）', async ({
  page,
}) => {
  const report: Record<string, unknown> = {};
  await page.goto('/');
  report['ホーム'] = await horizontalOverflow(page);
  await openFile(page, 'mozart-k464-1-allegro.mxl');
  report['楽譜'] = await horizontalOverflow(page);
  report['ツールバーではみ出す部品'] = await clippedToolbarItems(page);
  for (const panel of ['移調', '設定', '書き出し', '編曲']) {
    await page.getByRole('button', { name: panel, exact: true }).click();
    await page.waitForTimeout(200);
    report[panel] = await horizontalOverflow(page);
    await page.getByRole('button', { name: '閉じる' }).first().click();
  }
  console.log(`[${test.info().project.name}] UI-03 ${JSON.stringify(report)}`);
  for (const [k, v] of Object.entries(report)) {
    if (typeof v === 'number') expect(v, k).toBeLessThanOrEqual(0);
    else expect(v, k).toEqual([]);
  }
});

test('UI-04 表示範囲の既定値：PC・タブレットは総譜、スマホはパート譜', async ({ page }, info) => {
  await openFile(page, 'mozart-k464-1-allegro.mxl');
  const view = page.getByLabel('表示するパート');
  if (info.project.name === 'phone') await expect(view).not.toHaveValue('score');
  else await expect(view).toHaveValue('score');
});

test('UI-05 表示の設定は端末に保存され、リロード後も残る', async ({ page }) => {
  await openFile(page, 'mozart-k464-1-allegro.mxl');
  await page.getByRole('button', { name: '設定' }).click();
  const names = page.getByRole('radiogroup', { name: '音名' });
  await names.getByText('ドレミ').click();
  await page.getByRole('radiogroup', { name: '配色' }).getByText('ダーク').click();
  await page.reload();
  await page.getByLabel('楽譜ファイル').setInputFiles(assetPath('mozart-k464-1-allegro.mxl'));
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByRole('radiogroup', { name: '音名' }).getByRole('radio', { name: 'ドレミ' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: '配色' }).getByRole('radio', { name: 'ダーク' })).toBeChecked();
});

// ---------------------------------------------------------------- 一連の操作（読み込み→移調→編集→書き出し）

test('UI-06/07 読み込み→移調→編集→書き出し。書き出した MusicXML に移調と編集が入っている。エラーが出ない', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openFile(page, 'mozart-k464-1-allegro.mxl');

  // モードA：B♭メジャーへ（上げる）
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByLabel('移調先の調').selectOption({ label: 'B♭メジャー（♭2つ）' });
  await page.getByRole('button', { name: '移調する' }).click();
  await expect(page.getByRole('status')).toContainText('移調しました');

  // 第1ヴァイオリンの3つ目の音を1オクターブ上げる
  await page.getByLabel('表示するパート').selectOption({ index: 1 });
  await tapNote(page, 2);
  await page.getByRole('button', { name: '8va↑' }).click();
  await page.waitForTimeout(300);

  // 書き出し
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /MusicXML/ })
    .first()
    .click();
  const file = test.info().outputPath('exported.musicxml');
  copyFileSync(await (await download).path(), file);
  const result = JSON.parse(
    execFileSync(
      'npx',
      ['vite-node', 'tests/verification/ui/compare-export.ts', '--', assetPath('mozart-k464-1-allegro.mxl'), file],
      {
        encoding: 'utf8',
      },
    )
      .trim()
      .split('\n')
      .pop()!,
  ) as { keyFifths: number; onlyInA: string[]; onlyInB: string[] };

  // 期待：元の楽譜を短2度上げたもの（＝B♭メジャー）と比べて、違うのは1音だけで、ちょうど1オクターブ上
  // 休符の違いは IO-10 で別に見る。ここでは音の違いだけを見る
  const sounding = (lines: string[]) => lines.filter((l) => !l.includes(' rest'));
  expect(result.keyFifths).toBe(-2);
  expect(sounding(result.onlyInA)).toHaveLength(1);
  expect(sounding(result.onlyInB)).toHaveLength(1);
  const octaveOf = (line: string) =>
    Number(/^[A-G][^\d-]*(-?\d+)/.exec(line.split(' ').find((t) => /^[A-G]/.test(t))!)![1]);
  expect(octaveOf(sounding(result.onlyInB)[0]) - octaveOf(sounding(result.onlyInA)[0])).toBe(1);

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- 個別の要求

test('IO-10 正しく書かれた楽譜は、読み込み確認の既定のまま開いて書き出しても音符情報が変わらない', async ({ page }) => {
  // K.464 は反復記号で3/4の小節が「2拍＋1拍」に分かれている（第87小節と次の小節）。どちらも拍が足りないのではない
  await openFile(page, 'mozart-k464-1-allegro.mxl');
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /MusicXML/ })
    .first()
    .click();
  const file = test.info().outputPath('opened.musicxml');
  copyFileSync(await (await download).path(), file);
  const result = JSON.parse(
    execFileSync(
      'npx',
      [
        'vite-node',
        'tests/verification/ui/compare-export.ts',
        '--',
        assetPath('mozart-k464-1-allegro.mxl'),
        file,
        'P1',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .pop()!,
  ) as { onlyInA: string[]; onlyInB: string[] };
  expect(result.onlyInB).toEqual([]);
  expect(result.onlyInA).toEqual([]);
});

test('TR-12 曲の途中に転調がある楽譜を「調を指定」で♭7つの調へ移調できる', async ({ page }) => {
  const errors = collectErrors(page);
  const m = (n: number, key: number) =>
    `<measure number="${n}"><attributes>${n === 1 ? '<divisions>1</divisions>' : ''}<key><fifths>${key}</fifths></key>${
      n === 1 ? '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>' : ''
    }</attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure>`;
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1">${m(1, 3)}${m(2, -6)}</part></score-partwise>`;
  await openFile(page, { name: 'modulation.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: '移調', exact: true }).click();
  await page.getByLabel('移調先の調').selectOption({ label: 'C♭メジャー（♭7つ）' });
  await page.getByRole('button', { name: '移調する' }).click();
  await expect(page.getByRole('status')).toContainText('移調しました', { timeout: 3000 });
  expect(errors).toEqual([]);
});

test('IO-05 対応していない要素は「読み込まなかった要素」に出して、読み込みは続ける', async ({ page }) => {
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><unknown-thing/><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  await page.goto('/');
  await page
    .getByLabel('楽譜ファイル')
    .setInputFiles({ name: 'u.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.getByRole('heading', { name: '読み込まなかった要素' })).toBeVisible();
  await expect(page.getByText('unknown-thing（1か所）')).toBeVisible();
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
});

test('PB-03 アプリ内に音源のライセンスとクレジットが出て、全文が開ける', async ({ page, request }) => {
  await page.goto('/');
  await page.getByText('このアプリについて').click();
  await expect(page.getByText(/FluidR3_GM/)).toBeVisible();
  const href = await page.getByRole('link', { name: 'ライセンス全文' }).first().getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(/FluidR3|MIT/);
});
