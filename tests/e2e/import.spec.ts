import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const asset = (name: string) => new URL(`../../test-assets/musicxml/${name}`, import.meta.url).pathname;

test('MusicXMLを読み込み、パート・調・拍子・小節数を確認して書き出せる', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('楽譜ファイル').setInputFiles(asset('mozart-k464-1-allegro.mxl'));
  await expect(
    page.getByRole('heading', { name: 'String Quartet No.18 in A major, K.464 (Op. 10, No. 5)' }),
  ).toBeVisible();
  await expect(page.getByText('Aメジャー（♯3つ）')).toBeVisible();
  await expect(page.getByText('3/4')).toBeVisible();
  await expect(page.getByTestId('measure-count')).toHaveText('272');
  await expect(page.getByRole('cell', { name: 'ヴィオラ' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'MusicXMLとして書き出す' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('mozart-k464-1-allegro.musicxml');
  const xml = readFileSync(await file.path(), 'utf8');
  expect(xml).toContain('<score-partwise version="4.0">');
});

test('移調楽器を含むオーケストラ（500小節）を読み込める', async ({ page }) => {
  await page.goto('/');
  const t = Date.now();
  await page.getByLabel('楽譜ファイル').setInputFiles(asset('synthetic-orchestra-500.musicxml'));
  await expect(page.getByTestId('measure-count')).toHaveText('500');
  const parse = await page.getByText(/読み込み時間 \d+ms/).textContent();
  console.log(
    `[${test.info().project.name}] 合成オーケストラ：ファイル選択〜表示 ${Date.now() - t}ms（うち解析 ${parse}）`,
  );
  await expect(page.getByRole('row', { name: /Horn in E♭ 1.*記譜の長6度下が鳴る/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Clarinet in B♭ 1.*記譜の長2度下が鳴る/ })).toBeVisible();
});

test('読み込めないファイルは理由を表示する', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('楽譜ファイル')
    .setInputFiles({ name: 'song.mid', mimeType: 'audio/midi', buffer: Buffer.from('MThd\0\0\0\x06') });
  await expect(page.getByRole('alert')).toContainText('MIDIファイルが壊れているか、途中で切れています');
});

test('MIDIを読み込み、推定した楽譜として確認して開ける', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('楽譜ファイル')
    .setInputFiles(new URL('../../test-assets/midi/mozart-k464-1-allegro.mid', import.meta.url).pathname);
  await expect(page.getByText('Aメジャー（♯3つ）')).toBeVisible();
  await expect(page.getByText(/MIDIから推定した楽譜です/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ヴァイオリン 2' })).toBeVisible();
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  await expect(page.locator('section.chunk:not(.placeholder) g.note').first()).toBeVisible();
});

test('画像の楽譜は、読み取りソフトで MusicXML にする案内を出す', async ({ page }) => {
  await page.goto('/');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await page.getByLabel('楽譜ファイル').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('alert')).toContainText('画像の楽譜は直接読み込めません');
  await page.getByText('楽譜の画像・PDFから作るには', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Audiveris' })).toBeVisible();
});

test('拍の足りない小節（読み取りソフトの結果によくある）は休符で埋めて開ける', async ({ page }) => {
  const note = (step: string, dur: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>${dur}</duration><type>${type}</type></note>`;
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1">
  <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note('C', 4, 'whole')}</measure>
  <measure number="2">${note('D', 2, 'half')}</measure>
  <measure number="3">${note('E', 4, 'whole')}</measure></part></score-partwise>`;
  await page.goto('/');
  await page
    .getByLabel('楽譜ファイル')
    .setInputFiles({ name: 'omr.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const fill = page.getByLabel(/拍の足りない小節を休符で埋める/);
  await expect(fill).toBeChecked();
  await page.getByRole('button', { name: '楽譜を開く' }).click();
  // 2小節目に休符が足される
  await expect(page.locator('section.chunk:not(.placeholder) [id="m1"] g.rest')).toHaveCount(1);
});
