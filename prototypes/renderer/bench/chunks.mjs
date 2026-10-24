import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
execSync('npx tsc src/chunk.ts --outDir bench/out --target es2022 --module es2022 --lib es2022,dom --skipLibCheck', { stdio: 'inherit' });
const { splitMusicXml } = await import('./out/chunk.js');
const M = await createVerovioModule();
const tk = new VerovioToolkit(M);
tk.setOptions({ pageWidth: 2100, pageHeight: 60000, adjustPageHeight: true, scale: 40, breaks: 'auto', footer: 'none', header: 'none' });
let xml = fs.readFileSync('../../test-assets/musicxml/synthetic-orchestra-500.musicxml', 'utf8');
let n = 0; xml = xml.replace(/<note>/g, () => `<note id="n${n++}">`);
for (const size of [8, 16, 32]) {
  let t = performance.now();
  const chunks = splitMusicXml(xml, size, new DOMParser(), new XMLSerializer());
  const split = performance.now() - t;
  // 最初の表示（チャンク0〜2）
  t = performance.now();
  for (const c of chunks.slice(0, 3)) { tk.loadData(c.xml); tk.renderToSVG(1); }
  const first = performance.now() - t;
  // 全チャンク描画
  t = performance.now(); let maxOne = 0;
  for (const c of chunks) { const t1 = performance.now(); tk.loadData(c.xml); tk.renderToSVG(1); maxOne = Math.max(maxOne, performance.now() - t1); }
  const all = performance.now() - t;
  // 編集：チャンク5の最初の音のpitch stepを書き換えて再描画
  const c = chunks[5]; const id = c.xml.match(/<note id="(n\d+)"><pitch>/)[1];
  t = performance.now();
  const edited = c.xml.replace(new RegExp(`(<note id="${id}"><pitch><step>)[A-G]`), '$1G');
  tk.loadData(edited); const svg = tk.renderToSVG(1);
  const edit = performance.now() - t;
  console.log(`size=${size} chunks=${chunks.length} split=${split | 0}ms first3=${first | 0}ms all=${all | 0}ms maxChunk=${maxOne | 0}ms edit=${edit | 0}ms pages=${tk.getPageCount()} hasId=${svg.includes(`id="${id}"`)}`);
}
