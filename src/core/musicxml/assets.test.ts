import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readScoreFile } from './file';

const load = (name: string) =>
  readScoreFile(new Uint8Array(readFileSync(new URL(`../../../test-assets/musicxml/${name}`, import.meta.url))), name);

describe('テスト素材の読み込み', () => {
  it('弦楽四重奏：楽器・調・小節数', () => {
    const r = load('mozart-k464-1-allegro.mxl');
    expect(r.score.parts.map((p) => p.instrumentId)).toEqual(['violin', 'violin', 'viola', 'cello']);
    expect(r.score.measures[0].key).toEqual({ fifths: 3, mode: 'major' });
    expect(r.score.measures).toHaveLength(272);
    expect(r.ignored.filter((i) => !i.expected)).toEqual([]);
    // 繰り返しの前後で分割された小節（2拍＋1拍）は、拍が合わない小節に数えない
    expect(r.warnings.map((w) => w.code)).toEqual([]);
  });

  it('合成オーケストラ：移調楽器を実音で読み、実音の調号がそろう', () => {
    const r = load('synthetic-orchestra-500.musicxml');
    const byName = Object.fromEntries(r.score.parts.map((p) => [p.name, p]));
    expect(byName['Clarinet in B♭ 1'].instrumentId).toBe('clarinet-bb');
    expect(byName['Horn in E♭ 1']).toMatchObject({
      instrumentId: 'horn-f',
      transposition: { diatonic: -5, chromatic: -9 },
    });
    expect(byName['Contrabass'].instrumentId).toBe('contrabass');
    expect(byName['Contrabass'].transposition).toBeUndefined();
    expect(r.score.measures[0].key).toEqual({ fifths: -3, mode: 'minor' });
    expect(r.warnings).toEqual([]);
  });

  it('読み込みの速さ（目安。PCの目標は運命 第1楽章規模で1秒）', () => {
    const bytes = new Uint8Array(
      readFileSync(new URL('../../../test-assets/musicxml/synthetic-orchestra-500.musicxml', import.meta.url)),
    );
    readScoreFile(bytes, 'x.musicxml');
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      readScoreFile(bytes, 'x.musicxml');
      times.push(performance.now() - t);
    }
    const median = times.sort((a, b) => a - b)[1];
    console.log(`合成オーケストラ500小節の読み込み：中央値 ${Math.round(median)}ms`);
    // CIの遅いマシンでも落ちないよう、ここでは緩い上限だけ確かめる（正式な計測はブラウザのPlaywrightで行う）
    expect(median).toBeLessThan(5000);
  });
});
