import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffScores } from './compare';
import { exportMusicXml } from './export';
import { readScoreFile } from './file';
import { importMusicXml } from './import';

const FILES = [
  'mozart-k464-1-allegro.mxl',
  'mozart-k387.mxl',
  'beethoven-op18-1.mxl',
  'synthetic-orchestra-500.musicxml',
];

const load = (name: string) =>
  readScoreFile(new Uint8Array(readFileSync(new URL(`../../../test-assets/musicxml/${name}`, import.meta.url))), name);

describe('読み込み → 書き出し → 読み込み で音符情報が変わらない', () => {
  it.each(FILES)('%s', (name) => {
    const first = load(name).score;
    const xml = exportMusicXml(first, { date: '2026-01-01' });
    const second = importMusicXml(xml).score;
    const diff = diffScores(first, second);
    expect(diff.onlyInA.slice(0, 10)).toEqual([]);
    expect(diff.onlyInB.slice(0, 10)).toEqual([]);
    // 2回目の書き出しは1回目と同じ文字列になる（安定している）
    expect(exportMusicXml(second, { date: '2026-01-01' })).toBe(xml);
  });
});

describe('比較が違いを見つけられる', () => {
  it('音高・長さ・タイの違い', () => {
    const a = load('mozart-k464-1-allegro.mxl').score;
    const b = structuredClone(a);
    const target = b.notes.find((n) => n.heads.length === 1 && n.measure === 10)!;
    target.heads[0].pitch = { ...target.heads[0].pitch, octave: target.heads[0].pitch.octave + 1 };
    b.notes.find((n) => n.measure === 20)!.duration = { num: 1, den: 64 };
    expect(diffScores(a, b).onlyInA.length).toBe(2);
  });
});
