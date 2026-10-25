// 割当案から編成の楽譜を作る：縮約（各楽器1音）とオクターブ調整。純粋な関数だけ。
// 仕様：docs/spec.md「縮約（音を減らす）の優先順位」「処理の流れ」3〜4

import { ENSEMBLES, getInstrument } from '../instruments';
import { newId } from '../model/rhythm';
import { buildScoreIndex, type ScoreIndex } from '../model/scoreIndex';
import type { Arrangement, ClefChange, Direction, Note, Part, Role, Score } from '../model/types';
import { notationFor } from '../model/notation';
import { add, cmp, frac, lt, toNumber } from '../theory/fraction';
import { midi, type Pitch } from '../theory/pitch';
import { extractMelody, fixTies, pickTop, type HeadPicker } from '../transpose/transpose';
import type { Section } from './assign';

/** 拍ごとの音の集合から和音を推定する。三和音・七の和音の型に当てはまらなければ null */
export function estimateChord(
  pcs: Set<number>,
): { root: number; third: number; fifth: number; seventh?: number } | null {
  const shapes: [number, number, number?][] = [
    [4, 7, 10], // 属七
    [4, 7, 11], // 長七
    [3, 7, 10], // 短七
    [3, 6, 10], // 半減七
    [3, 6, 9], // 減七
    [4, 7], // 長三和音
    [3, 7], // 短三和音
    [3, 6], // 減三和音
  ];
  let best: { root: number; third: number; fifth: number; seventh?: number; score: number } | null = null;
  for (const root of pcs) {
    for (const [t, f, s] of shapes) {
      const tones = [root, (root + t) % 12, (root + f) % 12, ...(s !== undefined ? [(root + s) % 12] : [])];
      // 型の音のうち、根音と3度は必須。5度は省かれていてもよい
      if (!pcs.has(tones[1])) continue;
      if (s !== undefined && !pcs.has(tones[3])) continue;
      const covered = tones.filter((x) => pcs.has(x)).length;
      const extra = [...pcs].filter((x) => !tones.includes(x)).length;
      const score = covered * 2 - extra * 3;
      if (!best || score > best.score)
        best = { root, third: tones[1], fifth: tones[2], seventh: s !== undefined ? tones[3] : undefined, score };
    }
  }
  if (!best || best.score < 4) return null;
  const { score: _, ...chord } = best;
  return chord;
}

const pc = (p: Pitch) => ((midi(p) % 12) + 12) % 12;
const bottomPicker: HeadPicker = (cs) => {
  const all = cs.flatMap((note) => note.heads.map((head) => ({ note, head })));
  return all.reduce((a, b) => (midi(b.head.pitch) < midi(a.head.pitch) ? b : a));
};

type Taken = Map<string, Set<number>>; // 小節|拍の位置 → すでに鳴らしている音名
const at = (n: Note) => `${n.measure}|${n.onset.num}/${n.onset.den}`;

/**
 * 和声の楽器が和音から1音を選ぶ：ほかの楽器がまだ鳴らしていない音名を、3度 → 7度 → 根音 → 5度の順で。
 * 判定できなければ、ほかの楽器と重ならないいちばん高い音
 */
function harmonyPicker(taken: Taken, chordAt: Map<string, ReturnType<typeof estimateChord>>): HeadPicker {
  return (cs) => {
    const all = cs.flatMap((note) => note.heads.map((head) => ({ note, head })));
    const k = at(cs[0]);
    const used = taken.get(k) ?? new Set<number>();
    const chord = chordAt.get(k);
    const rank = (p: Pitch) => {
      const x = pc(p);
      let r = 10;
      if (chord) r = x === chord.third ? 0 : x === chord.seventh ? 1 : x === chord.root ? 2 : x === chord.fifth ? 3 : 4;
      return r + (used.has(x) ? 20 : 0);
    };
    return all.reduce((a, b) => {
      const d = rank(b.head.pitch) - rank(a.head.pitch);
      return d < 0 || (d === 0 && midi(b.head.pitch) > midi(a.head.pitch)) ? b : a;
    });
  };
}

/**
 * 楽器の音域に入るように、区間の音を丸ごとオクターブで動かし、それでもはみ出す音だけ1音ずつ動かす。
 * 動かし方は「入らない音の数 → 1音ずつ動かす音の数＋丸ごと動かす重み」が小さいものを選ぶ（線の形をなるべく保つ）
 */
export function fitOctaves(notes: Note[], instrumentId: string): Note[] {
  const [lo, hi] = getInstrument(instrumentId).range.practical.map(midi);
  const ms = notes.flatMap((n) => n.heads.map((h) => midi(h.pitch)));
  if (ms.length === 0) return notes;
  const fix = (m: number, shift: number) => {
    let o = shift;
    if (m + o * 12 > hi && m + (o - 1) * 12 >= lo) o--;
    else if (m + o * 12 < lo && m + (o + 1) * 12 <= hi) o++;
    return o;
  };
  const cost = (shift: number) => {
    let outside = 0;
    let moved = 0;
    for (const m of ms) {
      const o = fix(m, shift);
      if (o !== shift) moved++;
      if (m + o * 12 < lo || m + o * 12 > hi) outside++;
    }
    return outside * 100 + moved + Math.abs(shift) * Math.max(2, ms.length * 0.1);
  };
  const shift = [0, 1, -1, 2, -2, 3, -3].reduce((a, b) => (cost(b) < cost(a) ? b : a));
  return notes.map((n) => ({
    ...n,
    heads: n.heads.map((h) => {
      const o = fix(midi(h.pitch), shift);
      return o === 0 ? h : { ...h, pitch: { ...h.pitch, octave: h.pitch.octave + o } };
    }),
  }));
}

/** 元の単位（partId か partId#段）を、パートと段に分ける */
const splitUnit = (unitId: string) => {
  const [partId, staff] = unitId.split('#');
  return { partId, staff: staff ? Number(staff) : 1 };
};

const ROLE_ORDER: Role[] = ['melody-high', 'melody-mid', 'bass', 'counter', 'harmony', 'double'];

/** 割当案から編成の楽譜を作る。音はすべて「生成」（origin: 'generated'）で、元の音を derivedFrom に持つ */
export function buildArrangedScore(
  source: Score,
  arrangement: Arrangement,
  index: ScoreIndex = buildScoreIndex(source),
): Score {
  const ensemble = ENSEMBLES.find((e) => e.id === arrangement.ensembleId);
  if (!ensemble) throw new Error(`編成 ${arrangement.ensembleId} がありません`);
  const parts: Part[] = ensemble.instruments.map((id) => {
    const def = getInstrument(id);
    return { id, name: def.name.ja, abbr: def.abbr, instrumentId: id, staves: 1 };
  });
  const clefs: ClefChange[] = ensemble.instruments.map((id) => {
    const c = getInstrument(id).clefs.default;
    const sign = c.replace(/\d+$/, '') as ClefChange['sign'];
    return {
      partId: id,
      staff: 1,
      measure: 0,
      onset: { num: 0, den: 1 },
      sign,
      line: Number(c.slice(sign.length)) || 2,
    };
  });
  const notes: Note[] = [];
  const directions: Direction[] = [];

  for (const sec of arrangement.sections) {
    const taken: Taken = new Map();
    const chordAt = sectionChords(index, sec);
    // 役割の順に。同じ役割なら、その役割の候補の順（第1候補が元の高さで受け持ち、ほかは重ねる）
    const rank = (inst: string) => {
      const u = sec.mapping[inst]?.[0];
      const r = u ? sec.roles[u] : undefined;
      if (!r) return ROLE_ORDER.length * 10;
      const c = (ensemble.roles[r] ?? []).indexOf(inst);
      return ROLE_ORDER.indexOf(r) * 10 + (c < 0 ? 9 : c);
    };
    const order = [...ensemble.instruments].sort((a, b) => rank(a) - rank(b));
    const played = new Set<string>(); // この区間で、すでにほかの楽器が受け持った元の単位
    for (const inst of order) {
      const unitId = sec.mapping[inst]?.[0];
      let line: Note[];
      if (!unitId) line = restMeasures(index, inst, sec.start, sec.end);
      else {
        const { partId, staff } = splitUnit(unitId);
        const src: Note[] = [];
        for (let mi = sec.start; mi < sec.end; mi++) src.push(...(index.notes.get(partId)?.[mi] ?? []));
        const role = sec.roles[unitId];
        const picker = role === 'bass' ? bottomPicker : role === 'harmony' ? harmonyPicker(taken, chordAt) : pickTop;
        line = extractMelody(src, staff, picker).map((n) => ({
          ...n,
          id: newId('n'),
          partId: inst,
          staff: 1,
          voice: 1,
          heads: n.heads.map((h) => ({ ...h, id: newId('h') })),
          slurs: n.slurs?.map((s) => ({ ...s, id: `${s.id}-${inst}` })),
          origin: 'generated',
          derivedFrom: { sectionId: sec.id, sourcePartId: partId, sourceNoteIds: [n.id] },
        }));
        line = windIdioms(line, pizzicato(index.score, partId));
        // 区間で抜けている小節（元のパートに音符がない小節）は休符で埋める
        const have = new Set(line.map((n) => n.measure));
        for (let mi = sec.start; mi < sec.end; mi++)
          if (!have.has(mi)) line.push(...restMeasures(index, inst, mi, mi + 1));
        // 重ねて受け持つときは、楽器の音域の真ん中の側へ1オクターブ動かす（同じ高さで重ねない）
        if (played.has(unitId)) {
          const avg = average(line);
          if (!Number.isNaN(avg)) line = shiftLine(line, center(inst) >= avg ? 1 : -1);
        }
        played.add(unitId);
        line = fitOctaves(line, inst);
        for (const n of line) {
          if (n.heads.length === 0 || n.grace) continue;
          const k = at(n);
          taken.set(k, new Set([...(taken.get(k) ?? []), ...n.heads.map((h) => pc(h.pitch))]));
        }
        for (const d of index.score.directions) {
          if (d.partId !== partId || d.measure < sec.start || d.measure >= sec.end) continue;
          if (d.kind === 'text' && STRING_TEXT.test(d.value)) continue;
          // 強弱・ヘアピンは段が違っても写す（ピアノの強弱は段のあいだに書かれることが多い）
          if (d.staff !== staff && d.kind !== 'dynamic' && d.kind !== 'wedge') continue;
          directions.push({ ...d, id: newId('d'), partId: inst, staff: 1 });
        }
      }
      notes.push(...line);
    }
  }
  // 区間をまたいで別の元パートにつながったタイ・スラーは外す
  for (const p of parts) {
    const own = notes.filter((n) => n.partId === p.id);
    fixTies(own);
    fixSlurs(own);
  }
  return {
    ...source,
    id: newId('score-'),
    parts,
    notes,
    directions,
    clefs,
  };
}

/** 弦楽器などの奏法の指示（管楽器には写さない） */
const STRING_TEXT =
  /^\s*(arco|pizz\.?|pizzicato|div\.?|divisi|unis\.?|sul\b|col legno|con sord|senza sord|tremolo|trem\.)/i;

const center = (instrumentId: string) => {
  const [lo, hi] = getInstrument(instrumentId).range.practical.map(midi);
  return (lo + hi) / 2;
};

function average(line: Note[]): number {
  const ms = line.flatMap((n) => n.heads.map((h) => midi(h.pitch)));
  return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : NaN;
}

function shiftLine(line: Note[], octaves: number): Note[] {
  if (!octaves) return line;
  return line.map((n) => ({
    ...n,
    heads: n.heads.map((h) => ({ ...h, pitch: { ...h.pitch, octave: h.pitch.octave + octaves } })),
  }));
}

/** 区間の拍ごとの和音（元の楽譜の、鳴り始めの音すべてから） */
function sectionChords(index: ScoreIndex, sec: Section): Map<string, ReturnType<typeof estimateChord>> {
  const pcsAt = new Map<string, Set<number>>();
  for (const [, byMeasure] of index.notes) {
    for (let mi = sec.start; mi < sec.end; mi++) {
      for (const n of byMeasure[mi] ?? []) {
        if (n.grace) continue;
        const k = at(n);
        const set = pcsAt.get(k) ?? new Set<number>();
        for (const h of n.heads) set.add(pc(h.pitch));
        pcsAt.set(k, set);
      }
    }
  }
  return new Map([...pcsAt].map(([k, s]) => [k, estimateChord(s)]));
}

function restMeasures(index: ScoreIndex, partId: string, start: number, end: number): Note[] {
  const out: Note[] = [];
  for (let mi = start; mi < end; mi++) {
    out.push({
      id: newId('r'),
      partId,
      measure: mi,
      staff: 1,
      voice: 1,
      onset: { num: 0, den: 1 },
      duration: index.lengthAt[mi],
      heads: [],
      articulations: [],
      measureRest: true,
      origin: 'generated',
    });
  }
  return out;
}

/** 元のパートの pizz.（arco まで）の範囲にある音か */
function pizzicato(score: Score, partId: string): (n: Note) => boolean {
  const marks = score.directions
    .filter((d) => d.partId === partId && d.kind === 'text' && /^\s*(pizz|arco)/i.test(d.value))
    .map((d) => ({ at: d.measure + toNumber(d.onset) / 1000, on: /^\s*pizz/i.test(d.value) }))
    .sort((a, b) => a.at - b.at);
  return (n) => {
    const at = n.measure + toNumber(n.onset) / 1000;
    let on = false;
    for (const m of marks) if (m.at <= at) on = m.on;
    return on;
  };
}

const FAST = frac(1, 16);

/**
 * 管楽器向けに直す：トレモロの記号は外して長い音のまま、同じ高さの速い刻み（16分音符以下が4つ以上）は1つの長い音にまとめる。
 * pizz. の所の音にはスタッカートを付ける
 */
export function windIdioms(line: Note[], pizzAt: (n: Note) => boolean = () => false): Note[] {
  const sorted = [...line].sort((a, b) => a.measure - b.measure || cmp(a.onset, b.onset));
  const fast = (n: Note) => n.heads.length === 1 && !n.grace && !n.tuplets?.length && !lt(FAST, n.duration);
  const out: Note[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    if (fast(n) && !n.heads[0].tie) {
      let j = i;
      let total = n.duration;
      while (j + 1 < sorted.length) {
        const x = sorted[j + 1];
        if (
          !fast(x) ||
          x.heads[0].tie ||
          x.measure !== n.measure ||
          cmp(x.onset, add(n.onset, total)) !== 0 ||
          midi(x.heads[0].pitch) !== midi(n.heads[0].pitch)
        )
          break;
        total = add(total, x.duration);
        j++;
      }
      const notation = notationFor(total);
      if (j - i + 1 >= 4 && notation) {
        out.push({ ...n, duration: total, notation, beams: undefined, tremolo: undefined, slurs: undefined });
        i = j;
        continue;
      }
    }
    out.push(n.tremolo ? { ...n, tremolo: undefined } : n);
  }
  return out.map((n) =>
    n.heads.length && !n.grace && pizzAt(n) && !n.articulations.includes('staccato')
      ? { ...n, articulations: [...n.articulations, 'staccato'] }
      : n,
  );
}

/** 始まりと終わりの両方が残っていないスラーを外す */
function fixSlurs(notes: Note[]) {
  const count = new Map<string, number>();
  for (const n of notes) for (const s of n.slurs ?? []) count.set(s.id, (count.get(s.id) ?? 0) + 1);
  for (const n of notes) {
    if (!n.slurs) continue;
    const kept = n.slurs.filter((s) => count.get(s.id) === 2);
    n.slurs = kept.length ? kept : undefined;
  }
}
