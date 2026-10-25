import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Arrangement, Note, Score } from '../model/types';
import { exportMusicXml } from '../musicxml/export';
import { readScoreFile } from '../musicxml/file';
import { importMusicXml } from '../musicxml/import';
import { add, cmp, frac, toNumber, ZERO } from '../theory/fraction';
import { formatPitch, midi, parsePitch } from '../theory/pitch';
import { build } from './arrange.test';
import { planArrangement } from './assign';
import { buildArrangedScore, estimateChord, fitOctaves } from './build';
import { checkArrangement } from './check';

const pcs = (...names: string[]) => new Set(names.map((n) => midi(parsePitch(`${n}4`)) % 12));
const pitches = (s: Score, part: string, mi = 0) =>
  s.notes
    .filter((n) => n.partId === part && n.measure === mi)
    .sort((a, b) => toNumber(a.onset) - toNumber(b.onset))
    .map((n) => n.heads.map((h) => formatPitch(h.pitch)).join('+') || 'r');
const arrangement = (sections: Arrangement['sections']): Arrangement => ({
  id: 'a',
  sourceScoreId: 's',
  targetScoreId: '',
  ensembleId: 'wind-quintet',
  sections,
});

/** どのパートのどの小節も、音と休符の長さの合計が小節の長さちょうどで、重ならない */
function expectFilled(s: Score) {
  for (const p of s.parts) {
    for (const m of s.measures) {
      const ns = s.notes
        .filter((n) => n.partId === p.id && n.measure === m.index && !n.grace)
        .sort((a, b) => cmp(a.onset, b.onset));
      let pos = ZERO;
      for (const n of ns) {
        expect(cmp(n.onset, pos), `${p.id} 小節${m.index}`).toBe(0);
        pos = add(pos, n.duration);
      }
      expect(toNumber(pos), `${p.id} 小節${m.index} の長さ`).toBe(1);
    }
  }
}

describe('和音の推定', () => {
  it('三和音・七の和音・5度の省略', () => {
    expect(estimateChord(pcs('C', 'E', 'G'))).toMatchObject({ root: 0, third: 4, fifth: 7 });
    expect(estimateChord(pcs('G', 'B', 'D', 'F'))).toMatchObject({ root: 7, third: 11, seventh: 5 });
    expect(estimateChord(pcs('A', 'C'))).toMatchObject({ root: 9, third: 0 });
    expect(estimateChord(pcs('C', 'C#', 'D', 'D#'))).toBeNull();
  });
});

describe('編成の楽譜を作る', () => {
  it('和声の楽器は、ほかの楽器が鳴らしていない3度を選ぶ。バスは最低音', () => {
    const src = build({
      mel: { instrument: 'violin', measures: ['G5:1'] },
      chd: { instrument: 'piano', measures: ['C4:1'] },
      low: { instrument: 'cello', measures: ['C3:1'] },
    });
    // ピアノの和音 C4+E4+G4
    const chord = src.notes.find((n) => n.partId === 'chd')!;
    chord.heads.push({ id: 'e', pitch: parsePitch('E4') }, { id: 'g', pitch: parsePitch('G4') });
    const out = buildArrangedScore(
      src,
      arrangement([
        {
          id: 'sec1',
          start: 0,
          end: 1,
          roles: { mel: 'melody-mid', chd: 'harmony', low: 'bass' },
          mapping: { flute: ['mel'], oboe: [], 'clarinet-bb': [], 'horn-f': ['chd'], bassoon: ['chd'] },
        },
      ]),
    );
    expect(pitches(out, 'flute')).toEqual(['G5']);
    expect(pitches(out, 'horn-f')).toEqual(['E4']);
    expect(pitches(out, 'oboe')).toEqual(['r']);
    // ファゴット：ピアノの段から最低音（role は和声だが、元の役割に合わせて選ぶのは和声の規則）
    expect(pitches(out, 'bassoon')).toHaveLength(1);
    expectFilled(out);
    expect(out.notes.filter((n) => n.heads.length).every((n) => n.origin === 'generated' && n.derivedFrom)).toBe(true);
  });

  it('重ねて受け持つ楽器は音域の真ん中へ1オクターブ寄せる。arco などの弦の指示は写さない', () => {
    const src = build({ mel: { instrument: 'violin', measures: ['D5:1'] } });
    src.directions.push(
      { id: 'd1', partId: 'mel', measure: 0, onset: ZERO, staff: 1, kind: 'text', value: 'arco' },
      { id: 'd2', partId: 'mel', measure: 0, onset: ZERO, staff: 1, kind: 'dynamic', value: 'p' },
    );
    const out = buildArrangedScore(
      src,
      arrangement([
        {
          id: 'sec1',
          start: 0,
          end: 1,
          roles: { mel: 'melody-mid' },
          mapping: { flute: ['mel'], oboe: ['mel'], 'clarinet-bb': [], 'horn-f': [], bassoon: ['mel'] },
        },
      ]),
    );
    expect(pitches(out, 'oboe')).toEqual(['D5']); // 旋律（中）の第1候補が元の高さ
    expect(pitches(out, 'flute')).toEqual(['D6']);
    expect(pitches(out, 'bassoon')).toEqual(['D4']);
    expect(out.directions.map((d) => d.value)).toEqual(['p', 'p', 'p']);
  });

  it('音域に入るよう区間ごとオクターブで動かし、はみ出す音だけ1音ずつ動かす', () => {
    const n = (p: string): Note => ({
      id: p,
      partId: 'x',
      measure: 0,
      staff: 1,
      voice: 1,
      onset: ZERO,
      duration: frac(1, 4),
      heads: [{ id: p, pitch: parsePitch(p) }],
      articulations: [],
      origin: 'generated',
    });
    // フルート（C4〜C7）：C3 D3 E3 は全部1オクターブ上へ
    expect(fitOctaves([n('C3'), n('D3'), n('E3')], 'flute').map((x) => formatPitch(x.heads[0].pitch))).toEqual([
      'C4',
      'D4',
      'E4',
    ]);
    // ファゴット（B♭1〜D5）：A1 だけ上へ
    expect(fitOctaves([n('C3'), n('A1')], 'bassoon').map((x) => formatPitch(x.heads[0].pitch))).toEqual(['C3', 'A2']);
  });

  it('K.464 を木管5重奏に：全小節が埋まり、MusicXML に書き出して読み戻せる', () => {
    const name = 'mozart-k464-1-allegro.mxl';
    const source = readScoreFile(
      new Uint8Array(readFileSync(new URL(`../../../test-assets/musicxml/${name}`, import.meta.url))),
      name,
    ).score;
    const t0 = performance.now();
    const { arrangement: a } = planArrangement(source, 'wind-quintet');
    const out = buildArrangedScore(source, a);
    const warnings = checkArrangement(out, { source, arrangement: a });
    const ms = performance.now() - t0;
    console.log(
      `K.464 → 木管5重奏：${Math.round(ms)}ms、警告 ${warnings.length}件`,
      countBy(warnings.map((w) => w.kind)),
    );
    expect(out.parts.map((p) => p.instrumentId)).toEqual(['flute', 'oboe', 'clarinet-bb', 'horn-f', 'bassoon']);
    expect(out.notes.every((n) => n.heads.length <= 1)).toBe(true); // 管楽器は1音
    const back = importMusicXml(exportMusicXml(out)).score;
    expect(back.notes.filter((n) => n.heads.length).length).toBe(out.notes.filter((n) => n.heads.length).length);
    // 音域外は1オクターブ動かしても入らない音だけ
    expect(warnings.filter((w) => w.kind === 'range').length).toBeLessThan(10);
  });
});

describe('警告', () => {
  const quintet = (parts: Record<string, string[]>, tempo = 100) => {
    const s = build(
      Object.fromEntries(
        Object.entries(parts).map(([inst, measures]) => [inst, { instrument: inst, measures }]),
      ) as Record<string, { instrument: string; measures: string[] }>,
    );
    s.measures[0].tempo = { bpm: tempo, beatUnit: frac(1, 4) };
    return s;
  };
  const kinds = (s: Score) => checkArrangement(s).map((w) => `${w.kind}:${w.partId}`);

  it('息継ぎ：テンポ100で4/4を7小節休みなし（約17秒）', () => {
    expect(kinds(quintet({ flute: Array(7).fill('C5:1') }))).toEqual(['breath:flute']);
    expect(kinds(quintet({ flute: [...Array(3).fill('C5:1'), 'C5:2 -:2', ...Array(3).fill('C5:1')] }))).toEqual([]);
  });
  it('跳躍：1オクターブを超える跳躍が2回続く', () => {
    expect(kinds(quintet({ flute: ['C4:4 E5:4 C4:4 D4:4'] }))).toEqual(['leap:flute']);
    expect(kinds(quintet({ flute: ['C4:4 E5:4 D5:4 C4:4'] }))).toEqual([]);
  });
  it('ホルンの高音（E5以上）が2小節以上続く', () => {
    expect(kinds(quintet({ 'horn-f': ['E5:1', 'E5:1'] }))).toContain('horn-high:horn-f');
    expect(kinds(quintet({ 'horn-f': ['E5:1', 'C5:1'] }))).not.toContain('horn-high:horn-f');
  });
  it('音域外と音域の端', () => {
    expect(kinds(quintet({ flute: ['B3:4 C5:4 C5:4 C5:4'] }))).toEqual(['range:flute']);
    expect(kinds(quintet({ flute: ['A6:1'] }))).toEqual(['edge:flute']);
  });
  it('旋律の欠け：旋律がどの楽器にも割り当たらない', () => {
    const src = build({ mel: { instrument: 'violin', measures: ['C5:1'] } });
    const a = arrangement([
      {
        id: 'sec1',
        start: 0,
        end: 1,
        roles: { mel: 'melody-mid' },
        mapping: { flute: [], oboe: [], 'clarinet-bb': [], 'horn-f': [], bassoon: [] },
      },
    ]);
    const out = buildArrangedScore(src, a);
    expect(checkArrangement(out, { source: src, arrangement: a }).map((w) => w.kind)).toEqual(['melody-missing']);
  });
});

function countBy(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

describe('割当表の変更（作り直し）', () => {
  it('変えた楽器だけ作り直し、手で直した小節は残す', async () => {
    const { createArrangement, reassign } = await import('./workspace');
    const src = build({
      a: { instrument: 'violin', measures: ['G5:1', 'A5:1'] },
      b: { instrument: 'cello', measures: ['C3:1', 'D3:1'] },
    });
    const { arrangement, score } = createArrangement(src, 'wind-quintet', { starts: [0] });
    expect(arrangement.targetScoreId).toBe(score.id);
    const sec = arrangement.sections[0];
    // 2小節目のオーボエを手で直したことにする
    const edited: Score = {
      ...score,
      notes: score.notes.map((n) => (n.partId === 'oboe' && n.measure === 1 ? { ...n, origin: 'edited' } : n)),
    };
    const r = reassign(src, arrangement, edited, sec.id, 'oboe', ['b']);
    expect(r.arrangement.sections[0].mapping.oboe).toEqual(['b']);
    expect(r.kept).toBe(1);
    expect(r.result.message).toContain('1小節');
    expect(pitches(r.result.score, 'oboe', 0)).toEqual(['C4']); // チェロの線（オーボエの音域へ）
    expect(pitches(r.result.score, 'oboe', 1)).toEqual(pitches(edited, 'oboe', 1)); // 手直しは残る
    expect(pitches(r.result.score, 'flute', 0)).toEqual(pitches(edited, 'flute', 0)); // ほかの楽器は変わらない
    expect(r.result.changed).toEqual([0]);
  });
});
