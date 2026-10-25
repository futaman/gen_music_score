import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildScoreIndex } from '../model/scoreIndex';
import type { MeasureMeta, Note, Part, Score } from '../model/types';
import { readScoreFile } from '../musicxml/file';
import { frac } from '../theory/fraction';
import { parsePitch } from '../theory/pitch';
import { analyzeSection, estimateRoles, sectionStarts, sourceUnits } from './analyze';
import { planArrangement } from './assign';

/** パートごとに「小節 → 音の並び」。'C5:4' は4分音符、'-:2' は2分休符。拍子は4/4 */
function build(parts: Record<string, { instrument: string; measures: string[] }>, meta: Partial<MeasureMeta>[] = []) {
  const notes: Note[] = [];
  let k = 0;
  const count = Math.max(...Object.values(parts).map((p) => p.measures.length));
  for (const [pid, p] of Object.entries(parts)) {
    p.measures.forEach((m, mi) => {
      let pos = 0;
      for (const tok of m.split(' ').filter(Boolean)) {
        const [pitch, den] = tok.split(':');
        notes.push({
          id: `n${k++}`,
          partId: pid,
          measure: mi,
          staff: 1,
          voice: 1,
          onset: frac(pos, 16),
          duration: frac(16 / Number(den), 16),
          heads: pitch === '-' ? [] : [{ id: `h${k}`, pitch: parsePitch(pitch) }],
          articulations: [],
          origin: 'source',
        });
        pos += 16 / Number(den);
      }
    });
  }
  const score: Score = {
    schemaVersion: 1,
    id: 's',
    title: '',
    composer: '',
    parts: Object.entries(parts).map(([id, p]): Part => ({ id, name: id, instrumentId: p.instrument, staves: 1 })),
    measures: Array.from({ length: count }, (_, i) => ({
      index: i,
      displayNumber: String(i + 1),
      ...(i === 0 ? { key: { fifths: 0, mode: 'major' as const }, time: { beats: 4, beatType: 4 } } : {}),
      ...meta[i],
    })),
    notes,
    directions: [],
    clefs: [],
  };
  return score;
}

const rep = (s: string, n: number) => Array.from({ length: n }, () => s);
const MEL = 'G5:8 A5:8 B5:8 C6:8 D6:4 C6:4';
const quintetLike = build({
  mel: { instrument: 'violin', measures: rep(MEL, 4) },
  dbl: { instrument: 'violin', measures: rep('G4:8 A4:8 B4:8 C5:8 D5:4 C5:4', 4) },
  har: { instrument: 'viola', measures: rep('E4:2 F4:2', 4) },
  cnt: { instrument: 'viola', measures: rep('E5:2. D5:8 C5:8', 4) },
  bas: { instrument: 'cello', measures: rep('C3:4 C3:4 G2:4 C3:4', 4) },
  tacet: { instrument: 'cello', measures: rep('-:1', 4) },
});

describe('役割の推定', () => {
  it('旋律（高）・重複・和声・対旋律・バス・休み', () => {
    const index = buildScoreIndex(quintetLike);
    const a = analyzeSection(index, sourceUnits(index), 0, 4);
    expect(estimateRoles(a.stats)).toEqual({
      mel: 'melody-high',
      dbl: 'double',
      har: 'harmony',
      cnt: 'counter',
      bas: 'bass',
      tacet: 'rest',
    });
  });
});

describe('区間の区切り', () => {
  it('練習番号 → 全休止のあと → 8小節ごと', () => {
    const plain = build({ a: { instrument: 'flute', measures: rep('C5:1', 20) } });
    expect(sectionStarts(buildScoreIndex(plain))).toEqual([0, 8, 16]);
    const withGp = build({ a: { instrument: 'flute', measures: [...rep('C5:1', 5), '-:1', ...rep('C5:1', 4)] } });
    expect(sectionStarts(buildScoreIndex(withGp))).toEqual([0, 6]);
    const withMarks = build({ a: { instrument: 'flute', measures: rep('C5:1', 12) } }, [
      {},
      {},
      {},
      { rehearsal: 'A' },
    ]);
    expect(sectionStarts(buildScoreIndex(withMarks))).toEqual([0, 3]);
  });
});

describe('割当案', () => {
  it('旋律（高）→フルート、対旋律→クラリネット、和声→ホルン、バス→ファゴット。余ったオーボエは重ねる', () => {
    const { arrangement } = planArrangement(quintetLike, 'wind-quintet', { starts: [0] });
    const m = arrangement.sections[0].mapping;
    expect(m.flute).toEqual(['mel']);
    expect(m['clarinet-bb']).toEqual(['cnt']);
    expect(m['horn-f']).toEqual(['har']);
    expect(m.bassoon).toEqual(['bas']);
    expect(m.oboe).toHaveLength(1);
  });

  it('同じ楽器が2区間続けて旋律なら、次の区間は第2候補へ（オフにもできる）', () => {
    const melodyOf = (rotate: boolean) =>
      planArrangement(quintetLike, 'wind-quintet', {
        starts: [0, 1, 2, 3],
        rotateMelody: rotate,
      }).arrangement.sections.map((s) => Object.keys(s.mapping).find((i) => s.mapping[i][0] === 'mel'));
    expect(melodyOf(true)).toEqual(['flute', 'flute', 'oboe', 'flute']);
    expect(melodyOf(false)).toEqual(['flute', 'flute', 'flute', 'flute']);
  });

  it('K.464（弦楽四重奏）：第1ヴァイオリンが旋律、チェロがバス（ファゴット）になる区間が多い', () => {
    const name = 'mozart-k464-1-allegro.mxl';
    const score = readScoreFile(
      new Uint8Array(readFileSync(new URL(`../../../test-assets/musicxml/${name}`, import.meta.url))),
      name,
    ).score;
    const [vn1, , , vc] = score.parts.map((p) => p.id);
    const { arrangement } = planArrangement(score, 'wind-quintet');
    const secs = arrangement.sections;
    expect(secs.length).toBeGreaterThan(5);
    const share = (f: (s: (typeof secs)[number]) => boolean) => secs.filter(f).length / secs.length;
    expect(share((s) => s.roles[vn1]?.startsWith('melody'))).toBeGreaterThan(0.6);
    expect(share((s) => s.mapping.bassoon.includes(vc))).toBeGreaterThan(0.6);
    // どの区間も、休みでない元のパートはどれかの楽器に割り当たっている（重複は除く）
    for (const s of secs) {
      const assigned = new Set(Object.values(s.mapping).flat());
      for (const [u, r] of Object.entries(s.roles)) if (r !== 'rest' && r !== 'double') expect(assigned).toContain(u);
    }
  });
});
