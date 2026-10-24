import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRanges } from '../check/range';
import { writtenKey, writtenSpelling } from '../model/display';
import { partTransposition } from '../instruments';
import type { Note, Score } from '../model/types';
import { readScoreFile } from '../musicxml/file';
import { importMusicXml } from '../musicxml/import';
import { frac } from '../theory/fraction';
import { invert, parseInterval, withDirection } from '../theory/interval';
import { formatPitch, parsePitch } from '../theory/pitch';
import {
  duplicatePartAs,
  extractMelody,
  intervalToKey,
  shiftOctaves,
  simplifySpelling,
  transposeConcert,
} from './transpose';

const load = (name: string) =>
  readScoreFile(new Uint8Array(readFileSync(new URL(`../../../test-assets/musicxml/${name}`, import.meta.url))), name)
    .score;

/** 1パートの楽譜を、調と音高の列から作る */
function makeScore(fifths: number, pitches: string[], instrument = 'flute'): Score {
  const notes: Note[] = pitches.map((p, i) => ({
    id: `n${i}`,
    partId: 'P1',
    measure: i,
    staff: 1,
    voice: 1,
    onset: frac(0),
    duration: frac(1),
    heads: [{ id: `h${i}`, pitch: parsePitch(p) }],
    articulations: [],
    origin: 'source',
  }));
  return {
    schemaVersion: 1,
    id: 's',
    title: '',
    composer: '',
    parts: [{ id: 'P1', name: 'X', instrumentId: instrument, staves: 1 }],
    measures: pitches.map((_, i) => ({
      index: i,
      displayNumber: String(i + 1),
      ...(i === 0 ? { key: { fifths, mode: 'major' as const }, time: { beats: 4, beatType: 4 } } : {}),
    })),
    notes,
    directions: [],
    clefs: [],
  };
}
const pitches = (s: Score) => s.notes.map((n) => n.heads.map((h) => formatPitch(h.pitch)).join('+'));

describe('モードA：実音移調', () => {
  it('全12調 × 主要音程：移調 → 逆移調で元と一致（異名同音の置換なし）', () => {
    const intervals = ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
    for (let fifths = -6; fifths <= 6; fifths++) {
      // 調の主音から音階と、よく出る臨時記号（♯4・♭7）
      const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'F#4', 'Bb4'];
      const score = makeScore(fifths, scale);
      for (const iv of intervals) {
        for (const dir of ['up', 'down'] as const) {
          const interval = withDirection(parseInterval(iv), dir);
          const there = transposeConcert(score, { interval, enharmonicKeys: false }).score;
          const back = transposeConcert(there, { interval: invert(interval), enharmonicKeys: false }).score;
          if (transposeConcert(score, { interval, enharmonicKeys: false }).respelled) continue; // ±2 を超えた綴りは対象外
          expect(pitches(back)).toEqual(pitches(score));
          expect(back.measures[0].key).toEqual(score.measures[0].key);
        }
      }
    }
  });

  it('Aメジャー → B♭メジャー（短2度上）', () => {
    const s = transposeConcert(makeScore(3, ['A4', 'C#5', 'E5', 'G#4']), {
      interval: intervalToKey({ fifths: 3, mode: 'major' }, -2, 'up'),
    }).score;
    expect(s.measures[0].key).toEqual({ fifths: -2, mode: 'major' });
    expect(pitches(s)).toEqual(['B♭4', 'D5', 'F5', 'A4']);
  });

  it('♯・♭が7つを超える調は異名同音の調にする（Eメジャーを長3度上 → A♭メジャー）', () => {
    const s = transposeConcert(makeScore(4, ['E4', 'G#4']), { interval: parseInterval('M3') }).score;
    expect(s.measures[0].key?.fifths).toBe(-4);
    expect(pitches(s)).toEqual(['A♭4', 'C5']);
  });

  it('♯系／♭系を選べる（Cメジャーを増4度上：F♯ か G♭）', () => {
    const sharp = transposeConcert(makeScore(0, ['C4']), { interval: parseInterval('A4'), flavor: 'sharp' }).score;
    const flat = transposeConcert(makeScore(0, ['C4']), { interval: parseInterval('A4'), flavor: 'flat' }).score;
    expect([sharp.measures[0].key?.fifths, pitches(sharp)[0]]).toEqual([6, 'F♯4']);
    expect([flat.measures[0].key?.fifths, pitches(flat)[0]]).toEqual([-6, 'G♭4']);
  });

  it('小節範囲だけ移調すると、範囲の頭と直後に調号の変更が入る', () => {
    const s = transposeConcert(makeScore(0, ['C4', 'C4', 'C4', 'C4']), {
      interval: parseInterval('M2'),
      range: { start: 1, end: 3 },
    }).score;
    expect(s.measures.map((m) => m.key?.fifths)).toEqual([0, 2, undefined, 0]);
    expect(pitches(s)).toEqual(['C4', 'D4', 'D4', 'C4']);
  });

  it('一部のパートだけ移調すると、調号は変えない', () => {
    const s = transposeConcert(makeScore(0, ['C4']), { interval: parseInterval('M2'), partIds: ['P1', 'X'] });
    expect(s.score.measures[0].key?.fifths).toBe(2); // 全パート（P1 のみ）なので変わる
    const partial = transposeConcert(
      {
        ...makeScore(0, ['C4']),
        parts: [...makeScore(0, []).parts, { id: 'P2', name: 'Y', instrumentId: 'flute', staves: 1 }],
      },
      { interval: parseInterval('M2'), partIds: ['P1'] },
    );
    expect(partial.score.measures[0].key?.fifths).toBe(0);
  });

  it('移調先の調から音程を求める（上げる・下げる）', () => {
    expect(intervalToKey({ fifths: 3, mode: 'major' }, -2, 'up')).toEqual({ diatonic: 1, chromatic: 1 });
    expect(intervalToKey({ fifths: 3, mode: 'major' }, -2, 'down')).toEqual({ diatonic: -6, chromatic: -11 });
    expect(intervalToKey({ fifths: 0, mode: 'major' }, 0, 'down')).toEqual({ diatonic: 0, chromatic: 0 });
  });
});

describe('モードB：移調楽器のパート', () => {
  it('完了条件：K.464（イ長調）を B♭ へ移調し、第1ヴァイオリンを B♭クラのパートにすると Cメジャーで書かれる', () => {
    const score = load('mozart-k464-1-allegro.mxl');
    const toBb = intervalToKey(score.measures[0].key!, -2, 'up');
    const moved = transposeConcert(score, { interval: toBb }).score;
    expect(moved.measures[0].key).toEqual({ fifths: -2, mode: 'major' });
    const { score: withCl, partId } = duplicatePartAs(moved, {
      sourcePartId: moved.parts[0].id,
      instrumentId: 'clarinet-bb',
    });
    const cl = withCl.parts.find((p) => p.id === partId)!;
    expect(cl.instrumentId).toBe('clarinet-bb');
    expect(writtenKey(moved.measures[0].key!, partTransposition(cl)).fifths).toBe(0);
    // 移調せずに作ると Bメジャー（♯5つ）
    expect(writtenKey(score.measures[0].key!, partTransposition(cl)).fifths).toBe(5);
    // 元のパートは残る
    expect(withCl.parts).toHaveLength(5);
    // ヴァイオリン（重音あり）→ クラリネット（単旋律）なので旋律を取り出す：音の始まる位置は元と同じで、1音ずつ
    const where = (n: Note) => `${n.measure}|${n.onset.num}/${n.onset.den}|${n.grace ? 'g' : ''}`;
    const src = moved.notes.filter((n) => n.partId === moved.parts[0].id && n.heads.length);
    const made = withCl.notes.filter((n) => n.partId === partId && n.heads.length);
    expect(new Set(made.map(where))).toEqual(new Set(src.map(where)));
    expect(made.every((n) => n.heads.length === 1)).toBe(true);
  });

  it('移調楽器の調号：記号の少ない方、同数なら♯系（実音 E → B♭クラは F♯）、パートごとに♭系にもできる', () => {
    const cl = parseInterval('M2');
    const t = invert(cl); // 記譜 → 実音は長2度下
    expect(writtenSpelling({ fifths: 4, mode: 'major' }, t).key.fifths).toBe(6);
    expect(writtenSpelling({ fifths: 4, mode: 'major' }, t, 'flat').key.fifths).toBe(-6);
    // 実音 B（♯5）→ 記譜 C♯（♯7）より D♭（♭5）
    expect(writtenSpelling({ fifths: 5, mode: 'major' }, t).key.fifths).toBe(-5);
  });

  it('ピアノから単旋律を取り出す：右手のいちばん高い音、重なったら前の音を切る', () => {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
<note><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<forward><duration>2</duration></forward>
<note><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note>
</measure></part></score-partwise>`;
    const score = importMusicXml(xml).score;
    const melody = extractMelody(score.notes, 1);
    expect(
      melody.map((n) => [
        n.heads.map((h) => formatPitch(h.pitch)).join(),
        `${n.onset.num}/${n.onset.den}`,
        `${n.duration.num}/${n.duration.den}`,
      ]),
    ).toEqual([
      ['E5', '0/1', '1/4'],
      ['G5', '1/4', '1/4'],
    ]);
    const { score: withCl, partId } = duplicatePartAs(score, { sourcePartId: 'P1', instrumentId: 'clarinet-bb' });
    expect(
      withCl.notes.filter((n) => n.partId === partId).every((n) => n.origin === 'generated' && n.heads.length <= 1),
    ).toBe(true);
  });
});

describe('異名同音・音域', () => {
  it('異名同音で簡単にする', () => {
    const r = simplifySpelling(makeScore(0, ['Fx4', 'Cb5', 'E#4', 'Bbb3', 'F#4']));
    expect(r.changed).toBe(4);
    expect(pitches(r.score)).toEqual(['G4', 'B4', 'F4', 'A3', 'F♯4']);
  });

  it('音域外の音を見つけ、オクターブ移動の候補を出す', () => {
    const s = makeScore(0, ['C4', 'B3', 'D7', 'G7'], 'flute'); // フルートは C4〜C7
    const issues = checkRanges(s);
    expect(issues.map((i) => [formatPitch(i.pitch), i.kind, i.suggestOctaves])).toEqual([
      ['B3', 'low', 1],
      ['D7', 'high', -1],
      ['G7', 'high', -1],
    ]);
    const fixed = shiftOctaves(s, new Set(issues.map((i) => i.headId).slice(0, 1)), 1);
    expect(pitches(fixed)[1]).toBe('B4');
  });
});

describe('速さ', () => {
  it('曲全体の移調（合成オーケストラ 500小節）。PCの目標は1秒', () => {
    const score = load('synthetic-orchestra-500.musicxml');
    const t = performance.now();
    const r = transposeConcert(score, { interval: parseInterval('M2') });
    const ms = performance.now() - t;
    console.log(`合成オーケストラ全体の移調：${Math.round(ms)}ms（${r.score.notes.length}音符）`);
    expect(ms).toBeLessThan(1000);
  });
});
