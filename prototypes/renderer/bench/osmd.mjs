// OSMD の比較計測（PCの画面サイズ・CPU等倍のみ）
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
const PORT = 4180;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/osmd.html`)).ok) break; } catch {}
  if (i > 100) throw new Error('プレビューサーバーが起動しません');
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch();
for (const file of ['musicxml/beethoven-op18-1.mxl', 'musicxml/synthetic-orchestra-500.musicxml']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/osmd.html?file=${encodeURIComponent(file)}`);
  await page.waitForFunction(() => window.__osmd.done, null, { timeout: 500000 });
  console.log(file, JSON.stringify(await page.evaluate(() => window.__osmd)));
  await page.close();
}
await browser.close();
process.exit(0);
