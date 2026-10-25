// UI-06 の照合：画面から書き出した MusicXML と「元の楽譜を短2度上げたもの」を比べて JSON で出す。
// 使い方：npx vite-node tests/verification/ui/compare-export.ts -- <元の楽譜> <書き出したファイル> [P1]
// 3つ目に P1 を付けると移調せずに（完全1度で）比べる
import { readFileSync } from 'node:fs';
import { diffScores } from '../../../src/core/musicxml/compare';
import { readScoreFile } from '../../../src/core/musicxml/file';
import { parseInterval } from '../../../src/core/theory/interval';
import { transposeConcert } from '../../../src/core/transpose/transpose';

const [source, exported, unison] = process.argv.slice(2).filter((a) => a !== '--');
const read = (path: string) => readScoreFile(new Uint8Array(readFileSync(path)), path).score;
const expected = transposeConcert(read(source), { interval: parseInterval(unison ?? 'm2') }).score;
const actual = read(exported);
console.log(JSON.stringify({ keyFifths: actual.measures[0].key?.fifths, ...diffScores(expected, actual) }));
