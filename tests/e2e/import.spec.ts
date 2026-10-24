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
  await expect(page.getByRole('alert')).toContainText('MIDIファイルの読み込みにはまだ対応していません');
});
