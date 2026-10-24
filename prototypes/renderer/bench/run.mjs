// 試作の性能計測。vite preview を立ち上げ、3つの画面サイズ × CPU速度で
// 「最初の表示」「音高の変更」「再レイアウトが必要な変更」の時間を測る。
// スマホ・タブレットは CPU を 4倍遅くして近似する（実機の代わりにはならない）。
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // 環境に入っている Playwright を使う
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4179;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
server.on('exit', (code) => code && console.error(`プレビューサーバーが終了しました（${code}）`));
// サーバーが応答するまで待つ
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {}
  if (i > 100) throw new Error('プレビューサーバーが起動しません');
  await new Promise((r) => setTimeout(r, 200));
}
process.on('exit', () => server.kill());

const DEVICES = [
  { name: 'PC', viewport: { width: 1280, height: 800 }, cpu: 1, target: { first: 5000, edit: 200 } },
  { name: 'タブレット', viewport: { width: 1024, height: 1366 }, cpu: 4, touch: true, target: { first: 10000, edit: 300 } },
  { name: 'スマホ', viewport: { width: 390, height: 844 }, cpu: 4, touch: true, target: { first: 10000, edit: 300 } },
];
const FILES = (process.env.FILES ?? 'musicxml/synthetic-orchestra-500.musicxml,musicxml/beethoven-op18-1.mxl').split(',');
const SIZE = process.env.SIZE ?? '8';

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const max = (a) => Math.max(...a);
const browser = await chromium.launch();
const rows = [];
for (const file of FILES) {
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ viewport: d.viewport, hasTouch: !!d.touch, deviceScaleFactor: d.touch ? 2 : 1 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: d.cpu });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`http://localhost:${PORT}/?file=${encodeURIComponent(file)}&size=${SIZE}&scale=${d.viewport.width < 600 ? 25 : 35}`);
    await page.waitForFunction(() => window.__bench.ready || window.__bench.error, null, { timeout: 180000 });
    const b0 = await page.evaluate(() => window.__bench);
    if (b0.error) throw new Error(b0.error);
    // 2つ目の小節あたりの音符を選ぶ（スクロールしたチャンクの音符）
    const note = page.locator('section.chunk[data-chunk="1"] g.note').first();
    await note.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await note.locator('.notehead use, use').first().dispatchEvent('click'); // 符頭へのクリック（タップ）
    await page.waitForFunction(() => !document.getElementById('up').disabled);
    for (let i = 0; i < 10; i++) {
      await page.locator('#up').click();
      await page.waitForFunction((n) => window.__bench.timings.length >= n, i + 1);
    }
    for (let i = 0; i < 5; i++) {
      await page.locator('#dur').click();
      await page.waitForFunction((n) => window.__bench.timings.length >= n, 11 + i);
    }
    const b = await page.evaluate(() => window.__bench);
    const pitch = b.timings.filter((t) => t.kind === 'pitch');
    const relayout = b.timings.filter((t) => t.kind === 'relayout');
    const fastPitch = pitch.slice(1); // 1回目は別チャンクの読み込みが入りうる
    const row = {
      file: file.split('/').pop(), device: d.name, cpu: `${d.cpu}x`, chunks: b.chunks,
      firstPaintMs: Math.round(b.loadMs),
      pitchMedianMs: Math.round(median(fastPitch.map((t) => t.ms))), pitchMaxMs: Math.round(max(fastPitch.map((t) => t.ms))),
      relayoutMedianMs: Math.round(median(relayout.map((t) => t.ms))), relayoutMaxMs: Math.round(max(relayout.map((t) => t.ms))),
      firstOk: b.loadMs <= d.target.first, pitchOk: median(fastPitch.map((t) => t.ms)) <= d.target.edit, relayoutOk: median(relayout.map((t) => t.ms)) <= d.target.edit,
    };
    row.breakdown = ['pitch', 'relayout'].map((k) => {
      const ts = b.timings.filter((t) => t.kind === k).slice(1);
      return `${k}: worker ${Math.round(median(ts.map((t) => t.workerMs)))} / 往復 ${Math.round(median(ts.map((t) => t.roundTripMs)))} / DOM ${Math.round(median(ts.map((t) => t.domMs)))} / 合計 ${Math.round(median(ts.map((t) => t.ms)))} (${ts[0]?.path})`;
    });
    rows.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
}
await browser.close();
server.kill();
fs.mkdirSync('bench/results', { recursive: true });
fs.writeFileSync(`bench/results/size-${SIZE}.json`, JSON.stringify(rows, null, 1));
