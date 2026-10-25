// MuseScore 3 で読めるかの確認（CIでは動かさない。mscore3 が入っている環境で手動実行）。
// 1. テスト素材を読み込む → 2. このアプリで MusicXML に書き出す → 3. MuseScore で読み込んで MusicXML に書き出し直す
// → 4. それをこのアプリで読み込み、1 と音符情報を比べる。
// 使い方: npx vite-node scripts/check-musescore-roundtrip.ts  （または npm run check:musescore）
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffScores } from '../src/core/musicxml/compare';
import { exportMusicXml } from '../src/core/musicxml/export';
import { readScoreFile } from '../src/core/musicxml/file';
import { importMusicXml } from '../src/core/musicxml/import';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['mozart-k464-1-allegro.mxl', 'mozart-k387.mxl', 'beethoven-op18-1.mxl', 'synthetic-orchestra-500.musicxml'];
const dir = mkdtempSync(join(tmpdir(), 'mscore-'));
let failed = 0;
for (const name of files) {
  const original = readScoreFile(new Uint8Array(readFileSync(`test-assets/musicxml/${name}`)), name).score;
  const ours = join(dir, name.replace(/\.\w+$/, '') + '.ours.musicxml');
  const theirs = join(dir, name.replace(/\.\w+$/, '') + '.mscore.musicxml');
  writeFileSync(ours, exportMusicXml(original));
  execFileSync('mscore3', ['-o', theirs, ours], {
    env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
    stdio: 'ignore',
  });
  const back = importMusicXml(readFileSync(theirs, 'utf8')).score;
  const diff = diffScores(original, back);
  const ok = diff.onlyInA.length === 0 && diff.onlyInB.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? 'OK ' : 'NG '} ${name}  違い: 元にだけある ${diff.onlyInA.length} / MuseScore経由にだけある ${diff.onlyInB.length}`,
  );
  for (const l of diff.onlyInA.slice(0, 8)) console.log('   - ' + l);
  for (const l of diff.onlyInB.slice(0, 8)) console.log('   + ' + l);
}
process.exit(failed ? 1 : 0);
