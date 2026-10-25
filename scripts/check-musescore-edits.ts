// ステップ4の完了確認：楽譜を10か所編集 → このアプリで MusicXML に書き出し → MuseScore 3 で読み書き
// → このアプリで読み戻して、編集後の楽譜と音符情報が一致するか。mscore3 が入っている環境で手動実行。
// 使い方: npx vite-node scripts/check-musescore-edits.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../src/core/edit/commands';
import type { Score } from '../src/core/model/types';
import { diffScores } from '../src/core/musicxml/compare';
import { exportMusicXml } from '../src/core/musicxml/export';
import { readScoreFile } from '../src/core/musicxml/file';
import { importMusicXml } from '../src/core/musicxml/import';

const name = 'mozart-k464-1-allegro.mxl';
let score = readScoreFile(new Uint8Array(readFileSync(`test-assets/musicxml/${name}`)), name).score;
const P1 = score.parts[0].id;
const P2 = score.parts[1].id;
/** パートの mi 小節目以降で、音（休符を除く）が i+1 個以上ある最初の小節の i 番目の音 */
const note = (s: Score, part: string, mi: number, i = 0) => {
  for (let m = mi; m < s.measures.length; m++) {
    const list = s.notes
      .filter((n) => n.partId === part && n.measure === m && n.heads.length > 0 && !n.grace)
      .sort((a, b) => a.onset.num / a.onset.den - b.onset.num / b.onset.den);
    if (list[i]) return list[i];
  }
  throw new Error(`${part} の ${mi} 小節目以降に音がありません`);
};

// 画面と同じく、変わった小節は休符で埋める
const apply = (label: string, r: c.EditResult) => {
  if (r.changed !== 'all' && r.changed.length === 0) throw new Error(`${label}: 変わりませんでした（${r.message}）`);
  score = r.changed === 'all' ? r.score : c.fillMeasures(r.score, r.changed);
  console.log('編集', label);
};

apply('半音上げる', c.movePitch(score, [note(score, P1, 2).heads[0].id], 'semitone-up'));
apply('オクターブ下げる', c.movePitch(score, [note(score, P1, 3).heads[0].id], 'octave-down'));
apply('2分音符にする', c.setDuration(score, note(score, P1, 5).id, 'half'));
apply('付点', c.toggleDot(score, note(score, P2, 6).id));
apply('3連符', c.makeTuplet(score, note(score, P2, 8).id));
apply('休符にする', c.toRest(score, [note(score, P1, 10, 1).id]));
apply('和音を足す', c.addChordTone(score, note(score, P2, 12).id, 'E'));
apply('スタッカート', c.toggleArticulation(score, [note(score, P1, 14).id], 'staccato'));
apply('強弱 ff', c.setDynamic(score, note(score, P1, 16).id, 'ff'));
apply(
  '範囲をコピーして貼り付け',
  c.pasteRange(score, [P1], 20, c.copyRange(score, { partIds: [P1], start: 18, end: 19 })),
);

const dir = mkdtempSync(join(tmpdir(), 'mscore-edit-'));
const ours = join(dir, 'edited.musicxml');
const theirs = join(dir, 'edited.mscore.musicxml');
writeFileSync(ours, exportMusicXml(score));
execFileSync('mscore3', ['-o', theirs, ours], {
  env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
  stdio: 'ignore',
});
const back = importMusicXml(readFileSync(theirs, 'utf8')).score;
const diff = diffScores(score, back);
const ok = diff.onlyInA.length === 0 && diff.onlyInB.length === 0;
console.log(
  `${ok ? 'OK' : 'NG'}  違い: 編集後にだけある ${diff.onlyInA.length} / MuseScore経由にだけある ${diff.onlyInB.length}`,
);
for (const l of diff.onlyInA.slice(0, 10)) console.log('   - ' + l);
for (const l of diff.onlyInB.slice(0, 10)) console.log('   + ' + l);
process.exit(ok ? 0 : 1);
