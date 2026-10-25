// 同じ曲の MIDI と MusicXML を読み、音の始まり・高さ・長さの一致率を表示する（ステップ9の完了条件）。
// 使い方: npx vite-node scripts/check-midi.ts 曲.mid 曲.mxl   （または npm run check:midi -- 曲.mid 曲.mxl）
import { readFileSync } from 'node:fs';
import { matchRate } from '../src/core/midi/compare';
import { readScoreFile } from '../src/core/musicxml/file';

const [mid, xml] = process.argv.slice(2);
if (!mid || !xml) {
  console.error('使い方: npm run check:midi -- 曲.mid 曲.mxl');
  process.exit(2);
}
const a = readScoreFile(new Uint8Array(readFileSync(mid)), mid).score;
const b = readScoreFile(new Uint8Array(readFileSync(xml)), xml).score;
const r = matchRate(a, b);
console.log(
  `${mid} と ${xml}：${r.notes}音のうち 高さ ${(r.pitch * 100).toFixed(1)}%・長さ ${(r.duration * 100).toFixed(1)}% が一致`,
);
