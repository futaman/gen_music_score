// 移調。仕様：docs/spec.md「移調機能」「移調の細則」。
// モードA（実音移調）は楽譜そのものを書き換える。モードB（移調楽器向け記譜）は表示・書き出し時の変換で、
// ここではパートの複製と楽器の指定だけを行う。

import { getInstrument } from '../instruments';
import { makeRests, newId, splitDuration } from '../model/rhythm';
import type { ClefChange, Direction, MeasureMeta, Note, NoteHead, Part, Score } from '../model/types';
import { add, cmp, lt, sub, ZERO, type Fraction } from '../theory/fraction';
import { AlterOverflowError, intervalBetween, transposePitch, type Interval } from '../theory/interval';
import {
  chooseKey,
  normalizeKey,
  respellInterval,
  tonicOf,
  transposeKey,
  type Key,
  type KeyFlavor,
} from '../theory/key';
import { diatonicIndex, midi, simplifyEnharmonic, spellFromDiatonic, type Pitch } from '../theory/pitch';

export type TransposeOptions = {
  interval: Interval; // 上向きが正
  partIds?: string[]; // 省略時は全パート
  range?: { start: number; end: number }; // 小節index（end は含まない）。省略時は曲全体
  /** 調号を♯系・♭系のどちらで書くか。auto は♯・♭が7つを超えたときだけ異名同音の調にする */
  flavor?: KeyFlavor | 'keep';
  /** ♯・♭が7つを超える調を異名同音の調に置き換える（既定 true）。false にすると度数どおり（往復で元に戻る） */
  enharmonicKeys?: boolean;
};

export type TransposeResult = { score: Score; respelled: number };

/** 度数どおりに移調。変化記号が ±2 を超えるときは、近い音名に書き換える */
export function transposeSpelled(p: Pitch, iv: Interval): { pitch: Pitch; respelled: boolean } {
  try {
    return { pitch: transposePitch(p, iv), respelled: false };
  } catch (e) {
    if (!(e instanceof AlterOverflowError)) throw e;
    const m = midi(p) + iv.chromatic;
    const d = diatonicIndex(p) + iv.diatonic;
    const pitch = spellFromDiatonic(d + 1, m) ?? spellFromDiatonic(d - 1, m) ?? simplifyEnharmonic(p);
    return { pitch, respelled: true };
  }
}

/** 調の区間ごとに、調号の書き方（♯系／♭系）に合わせた音程を決める */
function sectionInterval(key: Key, iv: Interval, opts: TransposeOptions): { key: Key; interval: Interval } {
  const raw = transposeKey(key, iv);
  let chosen: Key;
  if (opts.flavor === 'keep' || opts.enharmonicKeys === false) chosen = raw;
  else if (opts.flavor === 'sharp' || opts.flavor === 'flat') chosen = chooseKey(raw, opts.flavor);
  else chosen = normalizeKey(raw);
  return { key: chosen, interval: respellInterval(iv, raw.fifths, chosen.fifths) };
}

/**
 * モードA：実音を移調する（曲の調を変える）。
 * 全パートを移調するときは調号も変える。小節範囲だけのときは、範囲の頭と直後に調号の変更を入れる。
 * 一部のパートだけのときは調号は変えない（調号は全パート共通のため。臨時記号で書かれる）。
 */
export function transposeConcert(score: Score, opts: TransposeOptions): TransposeResult {
  const n = score.measures.length;
  const start = opts.range?.start ?? 0;
  const end = Math.min(n, opts.range?.end ?? n);
  const parts = new Set(opts.partIds ?? score.parts.map((p) => p.id));
  const allParts = score.parts.every((p) => parts.has(p.id));
  const unpitched = new Set(score.parts.filter((p) => getInstrument(p.instrumentId).unpitched).map((p) => p.id));

  // 各小節の頭で有効な調
  const keyAt: Key[] = [];
  let key: Key = score.measures[0]?.key ?? { fifths: 0, mode: 'major' };
  for (const m of score.measures) {
    if (m.key) key = m.key;
    keyAt.push(key);
  }
  // 小節ごとの音程（調の区間ごとに決める）と、新しい調
  const ivAt: Interval[] = [];
  const newKeyAt: Key[] = [];
  for (let mi = 0; mi < n; mi++) {
    if (mi < start || mi >= end) {
      ivAt.push(opts.interval);
      newKeyAt.push(keyAt[mi]);
      continue;
    }
    const s = sectionInterval(keyAt[mi], opts.interval, opts);
    ivAt.push(allParts ? s.interval : opts.interval);
    newKeyAt.push(s.key);
  }

  const measures: MeasureMeta[] = score.measures.map((m) => ({ ...m }));
  if (allParts) {
    for (let mi = start; mi < end; mi++) {
      if (mi === start || score.measures[mi].key) measures[mi].key = newKeyAt[mi];
    }
    // 範囲の直後は元の調に戻す
    if (end < n && !score.measures[end].key) measures[end].key = keyAt[end];
    // 範囲の頭で、前の小節と同じ調なら書かない（曲頭は必ず書く）
    if (start > 0 && sameKey(measures[start].key, effectiveKey(measures, start - 1))) delete measures[start].key;
  }

  let respelled = 0;
  const notes = score.notes.map((note) => {
    if (!parts.has(note.partId) || unpitched.has(note.partId) || note.measure < start || note.measure >= end)
      return note;
    const iv = ivAt[note.measure];
    return {
      ...note,
      heads: note.heads.map((h) => {
        const r = transposeSpelled(h.pitch, iv);
        if (r.respelled) respelled++;
        return { ...h, pitch: r.pitch };
      }),
    };
  });
  return { score: { ...score, measures, notes }, respelled };
}

function effectiveKey(measures: MeasureMeta[], mi: number): Key | undefined {
  for (let i = mi; i >= 0; i--) if (measures[i].key) return measures[i].key;
  return undefined;
}

const sameKey = (a?: Key, b?: Key) => !!a && !!b && a.fifths === b.fifths && a.mode === b.mode;

/**
 * 移調先の調から音程を求める。dir：上げるか下げるか（同じ調でもオクターブ違いの2通りがある）。
 * 例：Aメジャー → B♭メジャー、上げる → 短2度上
 */
export function intervalToKey(from: Key, toFifths: number, dir: 'up' | 'down'): Interval {
  const a = tonicOf(from);
  const b = tonicOf({ fifths: toFifths, mode: from.mode });
  let iv = intervalBetween(a, b);
  // 1オクターブ以内の、指定した向きにする
  while (dir === 'up' && (iv.chromatic < 0 || (iv.chromatic === 0 && iv.diatonic < 0)))
    iv = { diatonic: iv.diatonic + 7, chromatic: iv.chromatic + 12 };
  while (dir === 'up' && iv.chromatic >= 12) iv = { diatonic: iv.diatonic - 7, chromatic: iv.chromatic - 12 };
  while (dir === 'down' && (iv.chromatic > 0 || (iv.chromatic === 0 && iv.diatonic > 0)))
    iv = { diatonic: iv.diatonic - 7, chromatic: iv.chromatic - 12 };
  while (dir === 'down' && iv.chromatic <= -12) iv = { diatonic: iv.diatonic + 7, chromatic: iv.chromatic + 12 };
  return iv;
}

/** 異名同音で簡単にする（ダブルシャープ・ダブルフラットと、B♯・C♭・E♯・F♭を書き換える） */
export function simplifySpelling(
  score: Score,
  opts: { partIds?: string[]; range?: { start: number; end: number } } = {},
): { score: Score; changed: number } {
  const parts = new Set(opts.partIds ?? score.parts.map((p) => p.id));
  const start = opts.range?.start ?? 0;
  const end = opts.range?.end ?? score.measures.length;
  let changed = 0;
  const odd = (p: Pitch) =>
    Math.abs(p.alter) === 2 ||
    (p.alter === 1 && (p.step === 'B' || p.step === 'E')) ||
    (p.alter === -1 && (p.step === 'C' || p.step === 'F'));
  const notes = score.notes.map((n) => {
    if (!parts.has(n.partId) || n.measure < start || n.measure >= end || !n.heads.some((h) => odd(h.pitch))) return n;
    return {
      ...n,
      heads: n.heads.map((h) => {
        if (!odd(h.pitch)) return h;
        changed++;
        return { ...h, pitch: simplifyEnharmonic(h.pitch) };
      }),
    };
  });
  return { score: { ...score, notes }, changed };
}

/** 音をオクターブ単位で動かす（音域外の音の修正などに使う） */
export function shiftOctaves(score: Score, headIds: Set<string>, octaves: number): Score {
  return {
    ...score,
    notes: score.notes.map((n) =>
      n.heads.some((h) => headIds.has(h.id))
        ? {
            ...n,
            heads: n.heads.map((h) =>
              headIds.has(h.id) ? { ...h, pitch: { ...h.pitch, octave: h.pitch.octave + octaves } } : h,
            ),
          }
        : n,
    ),
  };
}

// ---------------------------------------------------------------------------
// モードB：移調楽器のパートを作る（元のパートを複製して楽器を指定する）

export type DuplicateOptions = {
  sourcePartId: string;
  instrumentId: string;
  name?: string;
  /** 和音のパートから、旋律（1声部）を取り出す。省略時は「元が和音の楽器で、先が単旋律の楽器」なら取り出す */
  extractMelody?: boolean;
};

export function duplicatePartAs(score: Score, opts: DuplicateOptions): { score: Score; partId: string } {
  const source = score.parts.find((p) => p.id === opts.sourcePartId);
  if (!source) throw new Error(`パート ${opts.sourcePartId} がありません`);
  const def = getInstrument(opts.instrumentId);
  const extract = opts.extractMelody ?? (getInstrument(source.instrumentId).polyphonic && !def.polyphonic);
  const partId = newId('P');
  const part: Part = {
    id: partId,
    name: opts.name ?? def.name.ja,
    abbr: def.abbr,
    instrumentId: def.id,
    staves: 1,
  };
  const srcNotes = score.notes.filter((n) => n.partId === source.id);
  const picked = extract ? extractMelody(srcNotes, 1) : srcNotes.filter((n) => n.staff === 1);
  const notes: Note[] = picked.map((n) => ({
    ...n,
    id: newId('n'),
    partId,
    staff: 1,
    voice: extract ? 1 : n.voice,
    heads: n.heads.map((h) => ({ ...h, id: newId('h') })),
    slurs: n.slurs?.map((s) => ({ ...s, id: `${s.id}-${partId}` })),
    origin: extract ? 'generated' : n.origin,
    ...(extract ? { derivedFrom: { sectionId: '', sourcePartId: source.id, sourceNoteIds: [n.id] } } : {}),
  }));
  // 強弱などの記号は元の1段目のものを写す
  const directions: Direction[] = score.directions
    .filter((d) => d.partId === source.id && d.staff === 1)
    .map((d) => ({ ...d, id: newId('d'), partId }));
  const clefs: ClefChange[] = [{ partId, staff: 1, measure: 0, onset: ZERO, ...clefOf(def.clefs.default) }];
  const index = score.parts.findIndex((p) => p.id === source.id);
  const parts = [...score.parts.slice(0, index + 1), part, ...score.parts.slice(index + 1)];
  return {
    score: {
      ...score,
      parts,
      notes: [...score.notes, ...notes],
      directions: [...score.directions, ...directions],
      clefs: [...score.clefs, ...clefs],
    },
    partId,
  };
}

function clefOf(text: string): Pick<ClefChange, 'sign' | 'line'> {
  const sign = text.replace(/\d+$/, '');
  if (sign === 'percussion') return { sign: 'percussion', line: 3 };
  return { sign: sign as ClefChange['sign'], line: Number(text.slice(sign.length)) || 2 };
}

/** 同じ位置で始まる音（和音・複数の声部）から、残す1音を選ぶ */
export type HeadPicker = (candidates: Note[]) => { note: Note; head: NoteHead };

/** いちばん高い音 */
export const pickTop: HeadPicker = (cs) => {
  const note = cs.reduce((a, b) => (top(b) > top(a) ? b : a));
  return { note, head: note.heads.reduce((a, b) => (midi(b.pitch) > midi(a.pitch) ? b : a)) };
};

/**
 * 単旋律の取り出し：指定した段から、同時に鳴る音のうち1音（既定はいちばん高い音）を拾う。
 * 前の音が鳴っている間に次の音が始まったら、前の音はそこで切る。タイは両側が残ったときだけ残す。
 */
export function extractMelody(notes: Note[], staff: number, pick: HeadPicker = pickTop): Note[] {
  const byMeasure = new Map<number, Note[]>();
  const graces = notes.filter((n) => n.staff === staff && n.grace);
  for (const n of notes) {
    if (n.staff !== staff || n.grace) continue;
    let arr = byMeasure.get(n.measure);
    if (!arr) byMeasure.set(n.measure, (arr = []));
    arr.push(n);
  }
  const out: Note[] = [];
  for (const [, list] of [...byMeasure.entries()].sort((a, b) => a[0] - b[0])) {
    // 同じ位置で始まる音の中から1音を選ぶ
    const groups = new Map<string, Note[]>();
    for (const n of list) {
      if (n.heads.length === 0) continue;
      const key = `${n.onset.num}/${n.onset.den}`;
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    const picked = new Map<Note, NoteHead>();
    for (const cs of groups.values()) {
      const { note, head } = pick(cs);
      picked.set(note, head);
    }
    const sorted = [...picked.keys()].sort((a, b) => cmp(a.onset, b.onset));
    const measureEnd = list.reduce<Fraction>(
      (m, n) => (cmp(add(n.onset, n.duration), m) > 0 ? add(n.onset, n.duration) : m),
      ZERO,
    );
    let cursor: Fraction = ZERO;
    sorted.forEach((n, i) => {
      const next = sorted[i + 1]?.onset;
      let duration = n.duration;
      if (next && lt(next, add(n.onset, n.duration))) duration = sub(next, n.onset);
      if (cmp(n.onset, cursor) > 0) out.push(...makeRests({ ...n, voice: 1 }, cursor, sub(n.onset, cursor)));
      // 選んだ音の直前の装飾音（同じ声部）も残す
      for (const g of graces) {
        if (g.measure === n.measure && g.voice === n.voice && cmp(g.onset, n.onset) === 0)
          out.push({ ...g, voice: 1, beams: undefined });
      }
      const head = picked.get(n)!;
      const base: Note = { ...n, voice: 1, heads: [{ ...head }], beams: undefined };
      if (cmp(duration, n.duration) === 0) out.push(base);
      else out.push(...splitNote(base, n.onset, duration));
      cursor = add(n.onset, duration);
    });
    if (sorted.length && lt(cursor, measureEnd))
      out.push(...makeRests({ ...sorted[0], voice: 1 }, cursor, sub(measureEnd, cursor)));
    if (!sorted.length && list.length) {
      out.push({
        ...list[0],
        voice: 1,
        heads: [],
        onset: ZERO,
        duration: measureEnd,
        measureRest: true,
        beams: undefined,
      });
    }
  }
  fixTies(out);
  return out;
}

/** 途中で切った音を、書き表せる長さの音をタイでつないだものにする */
function splitNote(n: Note, onset: Fraction, duration: Fraction): Note[] {
  const pieces = splitDuration(duration);
  let pos = onset;
  return pieces.map((d, i) => {
    const tie = {
      ...(i === 0 ? { stop: n.heads[0].tie?.stop } : { stop: true }),
      ...(i < pieces.length - 1 ? { start: true } : {}),
    };
    const piece: Note = {
      ...n,
      id: i === 0 ? n.id : `${n.id}-${i}`,
      onset: pos,
      duration: d,
      notation: undefined,
      tuplets: undefined,
      heads: n.heads.map((h) => ({
        ...h,
        id: i === 0 ? h.id : `${h.id}-${i}`,
        tie: tie.start || tie.stop ? tie : undefined,
      })),
      articulations: i === 0 ? n.articulations : [],
      slurs: i === 0 ? n.slurs : undefined,
    };
    pos = add(pos, d);
    return piece;
  });
}

/** タイ：つながる相手（同じ高さで、終わった位置から始まる音）が残っていなければ外す */
export function fixTies(notes: Note[]) {
  const at = new Map<string, Note[]>();
  const key = (m: number, f: Fraction) => `${m}|${f.num}/${f.den}`;
  for (const n of notes) {
    const k = key(n.measure, n.onset);
    at.set(k, [...(at.get(k) ?? []), n]);
  }
  const ends = new Set<string>();
  for (const n of notes) {
    const end = add(n.onset, n.duration);
    for (const h of n.heads) {
      if (!h.tie?.start) continue;
      const next = [...(at.get(key(n.measure, end)) ?? []), ...(at.get(key(n.measure + 1, ZERO)) ?? [])];
      const target = next.flatMap((x) => x.heads).find((y) => y.tie?.stop && midi(y.pitch) === midi(h.pitch));
      if (target) ends.add(target.id);
      else h.tie = h.tie.stop ? { stop: true } : undefined;
    }
  }
  for (const n of notes)
    for (const h of n.heads) if (h.tie?.stop && !ends.has(h.id)) h.tie = h.tie.start ? { start: true } : undefined;
}

const top = (n: Note) => Math.max(...n.heads.map((h) => midi(h.pitch)));
