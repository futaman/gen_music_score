// 音符の編集。どの関数も元の楽譜を書き換えず、新しい楽譜と「変わった小節」を返す（元に戻すため）。
// 仕様：docs/spec.md「音符の編集」。音価の変更は上書き方式（長くすると後ろの音を削り、短くすると休符で埋める）。

import { getInstrument } from '../instruments';
import { notatedValue, notationFor, NOTE_TYPES, tupletRatio } from '../model/notation';
import { makeRests, newId } from '../model/rhythm';
import type { ClefChange, Direction, MeasureMeta, Note, NoteHead, NoteType, Score } from '../model/types';
import { add, cmp, frac, lt, mul, sub, ZERO, type Fraction } from '../theory/fraction';
import type { Interval } from '../theory/interval';
import { keyAlterations, type Key } from '../theory/key';
import { diatonicIndex, midi, spellFromDiatonic, STEPS, type Pitch, type Step } from '../theory/pitch';
import { transposeConcert } from '../transpose/transpose';

export type Range = { partIds: string[]; start: number; end: number }; // 小節index（end は含まない）
export type Selection = { kind: 'note'; noteId: string; headId?: string } | ({ kind: 'range' } & Range);

export type EditResult = {
  score: Score;
  /** 変わった小節（描き直す範囲）。'all' は全体 */
  changed: number[] | 'all';
  /** うまくできなかったときなどの説明 */
  message?: string;
  /** 編集のあとに選ぶもの */
  select?: Selection;
};

const unchanged = (score: Score, message: string): EditResult => ({ score, changed: [], message });

// ---- 小さな道具 ----

export function keyAt(score: Score, mi: number): Key {
  for (let i = mi; i >= 0; i--) if (score.measures[i]?.key) return score.measures[i].key!;
  return { fifths: 0, mode: 'major' };
}

export function measureLength(score: Score, mi: number): Fraction {
  for (let i = mi; i >= 0; i--) {
    const t = score.measures[i]?.time;
    if (t) return frac(t.beats, t.beatType);
  }
  return frac(1);
}

const byOnset = (a: Note, b: Note) => cmp(a.onset, b.onset) || Number(!a.grace) - Number(!b.grace);

function findNote(score: Score, noteId: string): Note | undefined {
  return score.notes.find((n) => n.id === noteId);
}

/** 同じ声部（パート・小節・段・声部）の音符（装飾音を除く）を時間順に */
function voiceOf(score: Score, n: Pick<Note, 'partId' | 'measure' | 'staff' | 'voice'>): Note[] {
  return score.notes
    .filter(
      (x) => x.partId === n.partId && x.measure === n.measure && x.staff === n.staff && x.voice === n.voice && !x.grace,
    )
    .sort(byOnset);
}

/** 音符の入れ替え：remove を消して add を足す */
function replace(score: Score, remove: Set<string>, add: Note[]): Score {
  return { ...score, notes: [...score.notes.filter((n) => !remove.has(n.id)), ...add] };
}

function mapNotes(score: Score, ids: Set<string>, f: (n: Note) => Note): Score {
  return { ...score, notes: score.notes.map((n) => (ids.has(n.id) ? f(n) : n)) };
}

const measuresOf = (score: Score, ids: Iterable<string>) => {
  const set = new Set<string>(ids);
  return [...new Set(score.notes.filter((n) => set.has(n.id)).map((n) => n.measure))];
};

// ---- 音高 ----

export type PitchMove =
  'semitone-up' | 'semitone-down' | 'step-up' | 'step-down' | 'octave-up' | 'octave-down' | 'enharmonic';

/** 半音上下したときの綴り：調号どおりの音 → 変化記号なし → 上なら♯・下なら♭ の順に選ぶ */
export function spellSemitone(p: Pitch, dir: 1 | -1, key: Key): Pitch {
  const m = midi(p) + dir;
  const d = diatonicIndex(p);
  const alt = keyAlterations(key.fifths);
  const candidates = [-1, 0, 1]
    .map((k) => spellFromDiatonic(d + k, m))
    .filter((c): c is Pitch => !!c && Math.abs(c.alter) <= 1);
  const score = (c: Pitch) =>
    c.alter === alt[c.step] ? 0 : c.alter === 0 ? 1 : (dir > 0 ? c.alter > 0 : c.alter < 0) ? 2 : 3;
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

/** 音階の上で1つ上下（調号どおりの変化にする） */
function stepMove(p: Pitch, dir: 1 | -1, key: Key): Pitch {
  const d = diatonicIndex(p) + dir;
  const step = STEPS[((d % 7) + 7) % 7];
  return { step, alter: keyAlterations(key.fifths)[step], octave: Math.floor(d / 7) };
}

/** 異名同音の綴りを順に切り替える（A♯ → B♭ → A♯ …） */
function nextEnharmonic(p: Pitch): Pitch {
  const m = midi(p);
  const d = diatonicIndex(p);
  const all = [-2, -1, 0, 1, 2]
    .map((k) => spellFromDiatonic(d + k, m))
    .filter((c): c is Pitch => !!c)
    .sort((a, b) => diatonicIndex(a) - diatonicIndex(b));
  const i = all.findIndex((c) => diatonicIndex(c) === d);
  return all[(i + 1) % all.length];
}

export function movePitch(score: Score, headIds: string[], how: PitchMove): EditResult {
  const ids = new Set(headIds);
  const touched: string[] = [];
  const notes = score.notes.map((n) => {
    if (!n.heads.some((h) => ids.has(h.id))) return n;
    touched.push(n.id);
    const key = keyAt(score, n.measure);
    return {
      ...n,
      origin: editedOrigin(n),
      heads: n.heads.map((h) => {
        if (!ids.has(h.id) || h.unpitched) return h;
        const p = h.pitch;
        const next =
          how === 'semitone-up'
            ? spellSemitone(p, 1, key)
            : how === 'semitone-down'
              ? spellSemitone(p, -1, key)
              : how === 'step-up'
                ? stepMove(p, 1, key)
                : how === 'step-down'
                  ? stepMove(p, -1, key)
                  : how === 'octave-up'
                    ? { ...p, octave: p.octave + 1 }
                    : how === 'octave-down'
                      ? { ...p, octave: p.octave - 1 }
                      : nextEnharmonic(p);
        return { ...h, pitch: next };
      }),
    };
  });
  if (!touched.length) return unchanged(score, '音高を変えられる音が選ばれていません');
  const next = { ...score, notes };
  return { score: next, changed: measuresOf(next, touched) };
}

const editedOrigin = (n: Note): Note['origin'] =>
  n.origin === 'generated' ? 'edited' : n.origin === 'source' ? 'edited' : n.origin;

/** 基準の音にいちばん近いオクターブで、音名（調号どおりの変化）の音を作る */
export function nearestPitch(step: Step, key: Key, reference: Pitch): Pitch {
  const alter = keyAlterations(key.fifths)[step];
  const refMidi = midi(reference);
  let best: Pitch = { step, alter, octave: reference.octave };
  for (const octave of [reference.octave - 1, reference.octave, reference.octave + 1]) {
    const c = { step, alter, octave };
    if (Math.abs(midi(c) - refMidi) < Math.abs(midi(best) - refMidi)) best = c;
  }
  return best;
}

/** 直前の音（同じパート・段・声部をさかのぼる）。なければ楽器の音域の真ん中 */
function referencePitch(score: Score, n: Note): Pitch {
  const prev = score.notes
    .filter(
      (x) =>
        x.partId === n.partId &&
        x.staff === n.staff &&
        x.heads.length &&
        (x.measure < n.measure || (x.measure === n.measure && lt(x.onset, n.onset))),
    )
    .sort((a, b) => b.measure - a.measure || cmp(b.onset, a.onset))[0];
  if (prev) return prev.heads[prev.heads.length - 1].pitch;
  if (n.heads.length) return n.heads[0].pitch;
  const part = score.parts.find((p) => p.id === n.partId);
  const r = getInstrument(part?.instrumentId ?? 'unknown').range.practical;
  const mid = Math.round((midi(r[0]) + midi(r[1])) / 2);
  return spellFromDiatonic(Math.round(((mid - 12) * 7) / 12), mid) ?? { step: 'C', alter: 0, octave: 4 };
}

/** 次の音符（同じ声部の次。小節の最後なら次の小節の最初） */
export function nextEvent(score: Score, n: Note): Note | undefined {
  const same = voiceOf(score, n);
  const i = same.findIndex((x) => x.id === n.id);
  if (i >= 0 && i < same.length - 1) return same[i + 1];
  for (let mi = n.measure + 1; mi < score.measures.length; mi++) {
    const v = voiceOf(score, { ...n, measure: mi });
    if (v.length) return v[0];
    const v1 = voiceOf(score, { ...n, measure: mi, voice: 1 });
    if (v1.length) return v1[0];
  }
  return undefined;
}

export function previousEvent(score: Score, n: Note): Note | undefined {
  const same = voiceOf(score, n);
  const i = same.findIndex((x) => x.id === n.id);
  if (i > 0) return same[i - 1];
  for (let mi = n.measure - 1; mi >= 0; mi--) {
    const v = voiceOf(score, { ...n, measure: mi });
    if (v.length) return v[v.length - 1];
  }
  return undefined;
}

/** 音名で入力：選んだ音符（休符なら音にする）をその音名にして、次の音符へ進む */
export function enterPitch(score: Score, noteId: string, step: Step): EditResult {
  const n = findNote(score, noteId);
  if (!n) return unchanged(score, '音符が選ばれていません');
  const p = nearestPitch(step, keyAt(score, n.measure), referencePitch(score, n));
  const head: NoteHead = { id: n.heads[0]?.id ?? newId('h'), pitch: p };
  const updated: Note = { ...n, heads: [head], measureRest: undefined, origin: editedOrigin(n) };
  if (n.measureRest) updated.notation = notationFor(n.duration) ?? undefined;
  const next = mapNotes(score, new Set([n.id]), () => updated);
  const after = nextEvent(next, updated);
  return {
    score: next,
    changed: [n.measure],
    select: after ? { kind: 'note', noteId: after.id } : { kind: 'note', noteId: n.id },
  };
}

/** 和音に音を足す（ピアノなど和音を弾ける楽器だけ） */
export function addChordTone(score: Score, noteId: string, step: Step): EditResult {
  const n = findNote(score, noteId);
  if (!n || !n.heads.length) return unchanged(score, '音を足す音符を選んでください');
  const part = score.parts.find((p) => p.id === n.partId);
  if (!getInstrument(part?.instrumentId ?? 'unknown').polyphonic) {
    return unchanged(score, 'この楽器は和音を弾けないため、音を足せません');
  }
  const top = n.heads.reduce((a, b) => (midi(b.pitch) > midi(a.pitch) ? b : a)).pitch;
  // いちばん上の音より上で、いちばん近い音
  let p = nearestPitch(step, keyAt(score, n.measure), top);
  if (midi(p) <= midi(top)) p = { ...p, octave: p.octave + 1 };
  if (n.heads.some((h) => midi(h.pitch) === midi(p))) return unchanged(score, 'その音はもう入っています');
  const head: NoteHead = { id: newId('h'), pitch: p };
  const next = mapNotes(score, new Set([n.id]), (x) => ({ ...x, heads: [...x.heads, head], origin: editedOrigin(x) }));
  return { score: next, changed: [n.measure], select: { kind: 'note', noteId: n.id, headId: head.id } };
}

// ---- 音価 ----

/**
 * 音価を変える（上書き方式）。長くすると後ろの音を削り、短くすると休符で埋める。
 * 小節からはみ出しても切らない（拍が合わない小節として警告する）。連符の中の音は変えない。
 */
export function setDuration(score: Score, noteId: string, type: NoteType, dots = 0): EditResult {
  const n = findNote(score, noteId);
  if (!n) return unchanged(score, '音符が選ばれていません');
  if (n.grace) {
    const next = mapNotes(score, new Set([n.id]), (x) => ({
      ...x,
      notation: { type, dots },
      duration: notatedValue(type, dots),
    }));
    return { score: next, changed: [n.measure] };
  }
  if (n.tuplets?.length) return unchanged(score, '連符の中の音の長さは変えられません');
  const newDur = notatedValue(type, dots);
  const end = add(n.onset, newDur);
  const oldEnd = add(n.onset, n.duration);
  const voice = voiceOf(score, n);
  const remove = new Set<string>();
  const added: Note[] = [];
  // 新しい長さの中に始まる音を消す。消した音が新しい終わりより後ろまで続いていたら、その残りは休符にする
  let coveredUntil = end;
  for (const x of voice) {
    if (x.id === n.id || cmp(x.onset, n.onset) <= 0 || cmp(x.onset, end) >= 0) continue;
    remove.add(x.id);
    const xEnd = add(x.onset, x.duration);
    if (cmp(xEnd, coveredUntil) > 0) coveredUntil = xEnd;
  }
  // 消した音の装飾音も消す
  for (const g of score.notes) {
    if (
      g.grace &&
      g.partId === n.partId &&
      g.measure === n.measure &&
      g.voice === n.voice &&
      remove.has(voice.find((v) => cmp(v.onset, g.onset) === 0)?.id ?? '')
    ) {
      remove.add(g.id);
    }
  }
  if (cmp(coveredUntil, end) > 0) added.push(...makeRests(n, end, sub(coveredUntil, end)));
  // 短くしたら、空いたところを休符で埋める
  if (lt(end, oldEnd)) added.push(...makeRests(n, end, sub(oldEnd, end)));
  remove.add(n.id);
  added.push({
    ...n,
    duration: newDur,
    notation: { type, dots },
    measureRest: undefined,
    beams: undefined,
    origin: n.heads.length ? editedOrigin(n) : n.origin,
  });
  return { score: replace(score, remove, added), changed: [n.measure], select: { kind: 'note', noteId: n.id } };
}

export function toggleDot(score: Score, noteId: string): EditResult {
  const n = findNote(score, noteId);
  if (!n) return unchanged(score, '音符が選ばれていません');
  const cur = n.notation ?? notationFor(n.duration, tupletRatio(n));
  if (!cur) return unchanged(score, 'この音符には付点を付けられません');
  return setDuration(score, noteId, cur.type, cur.dots ? 0 : 1);
}

/** 連符にする：選んだ音符の長さを3つ（actual）に分ける。最初は元の音、残りは休符 */
export function makeTuplet(score: Score, noteId: string, actual = 3): EditResult {
  const n = findNote(score, noteId);
  if (!n || n.grace) return unchanged(score, '音符が選ばれていません');
  if (n.tuplets?.length) return unchanged(score, 'すでに連符です');
  const cur = notationFor(n.duration);
  if (!cur || cur.dots) return unchanged(score, '付点のない音符を選んでください');
  const i = NOTE_TYPES.indexOf(cur.type);
  const inner = NOTE_TYPES[i + 1];
  if (!inner) return unchanged(score, 'これより短い連符は作れません');
  const normal = actual === 3 ? 2 : actual === 5 || actual === 6 ? 4 : actual === 7 ? 4 : 2;
  const each = mul(n.duration, frac(1, actual));
  const tid = newId('t');
  const pieces: Note[] = [];
  for (let k = 0; k < actual; k++) {
    const base: Note =
      k === 0
        ? { ...n, beams: undefined, origin: n.heads.length ? editedOrigin(n) : n.origin }
        : {
            id: newId('r'),
            partId: n.partId,
            measure: n.measure,
            staff: n.staff,
            voice: n.voice,
            onset: ZERO,
            duration: ZERO,
            heads: [],
            articulations: [],
            origin: 'edited',
          };
    pieces.push({
      ...base,
      onset: add(n.onset, mul(each, frac(k))),
      duration: each,
      notation: { type: inner, dots: 0 },
      tuplets: [
        { id: tid, actual, normal, ...(k === 0 ? { start: true } : {}), ...(k === actual - 1 ? { stop: true } : {}) },
      ],
    });
  }
  return {
    score: replace(score, new Set([n.id]), pieces),
    changed: [n.measure],
    select: { kind: 'note', noteId: n.id },
  };
}

/** 休符にする（削除）。小節全体を選んだときは全休符にする */
export function toRest(score: Score, noteIds: string[]): EditResult {
  const ids = new Set(noteIds);
  const next = mapNotes(score, ids, (n) => ({
    ...n,
    heads: [],
    slurs: undefined,
    articulations: [],
    tremolo: undefined,
    beams: undefined,
    origin: editedOrigin(n),
  }));
  // 装飾音は休符にせず消す
  const graces = score.notes.filter((n) => ids.has(n.id) && n.grace).map((n) => n.id);
  return { score: graces.length ? replace(next, new Set(graces), []) : next, changed: measuresOf(score, ids) };
}

// ---- つなぎ・記号 ----

/** タイの付け外し：選んだ音と、次の同じ高さの音をつなぐ */
export function toggleTie(score: Score, noteId: string): EditResult {
  const n = findNote(score, noteId);
  if (!n || !n.heads.length) return unchanged(score, '音を選んでください');
  const next = nextEvent(score, n);
  const on = !n.heads.some((h) => h.tie?.start);
  if (on && (!next || !next.heads.some((h) => n.heads.some((x) => midi(x.pitch) === midi(h.pitch))))) {
    return unchanged(score, '次の音が同じ高さではないため、タイでつなげません');
  }
  const pitches = new Set(n.heads.map((h) => midi(h.pitch)));
  let out = mapNotes(score, new Set([n.id]), (x) => ({
    ...x,
    heads: x.heads.map((h) => ({ ...h, tie: cleanTie({ ...h.tie, start: on || undefined }) })),
  }));
  if (next) {
    out = mapNotes(out, new Set([next.id]), (x) => ({
      ...x,
      heads: x.heads.map((h) =>
        pitches.has(midi(h.pitch)) ? { ...h, tie: cleanTie({ ...h.tie, stop: on || undefined }) } : h,
      ),
    }));
  }
  return { score: out, changed: [...new Set([n.measure, ...(next ? [next.measure] : [])])] };
}

const cleanTie = (t: { start?: boolean; stop?: boolean }) =>
  t.start || t.stop ? { ...(t.start ? { start: true } : {}), ...(t.stop ? { stop: true } : {}) } : undefined;

/** スラーの付け外し：from から to まで（同じパート） */
export function toggleSlur(score: Score, fromId: string, toId: string): EditResult {
  const a = findNote(score, fromId);
  const b = findNote(score, toId);
  if (!a || !b || a.partId !== b.partId || a === b)
    return unchanged(score, 'スラーは同じパートの2つの音符を選んでください');
  const [first, last] = a.measure < b.measure || (a.measure === b.measure && lt(a.onset, b.onset)) ? [a, b] : [b, a];
  const existing = first.slurs?.find(
    (s) => s.type === 'start' && last.slurs?.some((t) => t.id === s.id && t.type === 'stop'),
  );
  if (existing) {
    const out = mapNotes(score, new Set([first.id, last.id]), (x) => ({
      ...x,
      slurs: x.slurs?.filter((s) => s.id !== existing.id),
    }));
    return { score: out, changed: range(first.measure, last.measure) };
  }
  const id = newId('s');
  let out = mapNotes(score, new Set([first.id]), (x) => ({
    ...x,
    slurs: [...(x.slurs ?? []), { id, type: 'start' as const }],
  }));
  out = mapNotes(out, new Set([last.id]), (x) => ({
    ...x,
    slurs: [...(x.slurs ?? []), { id, type: 'stop' as const }],
  }));
  return { score: out, changed: range(first.measure, last.measure) };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** アーティキュレーション（staccato・accent・tenuto・fermata など）の付け外し */
export function toggleArticulation(score: Score, noteIds: string[], name: string): EditResult {
  const ids = new Set(noteIds);
  const targets = score.notes.filter((n) => ids.has(n.id) && n.heads.length);
  if (!targets.length) return unchanged(score, '音を選んでください');
  const on = !targets.every((n) => n.articulations.includes(name));
  const next = mapNotes(score, new Set(targets.map((n) => n.id)), (n) => ({
    ...n,
    articulations: on
      ? [...n.articulations.filter((a) => a !== name), name]
      : n.articulations.filter((a) => a !== name),
  }));
  return { score: next, changed: measuresOf(score, ids) };
}

/** 強弱記号を付ける（同じ位置の強弱は置き換える）。value が null なら消す */
export function setDynamic(score: Score, noteId: string, value: string | null): EditResult {
  const n = findNote(score, noteId);
  if (!n) return unchanged(score, '音符を選んでください');
  const same = (d: Direction) =>
    d.kind === 'dynamic' && d.partId === n.partId && d.measure === n.measure && cmp(d.onset, n.onset) === 0;
  const directions = score.directions.filter((d) => !same(d));
  if (value) {
    directions.push({
      id: newId('d'),
      partId: n.partId,
      measure: n.measure,
      onset: n.onset,
      staff: n.staff,
      kind: 'dynamic',
      value,
      placement: 'below',
    });
  }
  return { score: { ...score, directions }, changed: [n.measure] };
}

export function setTempo(score: Score, mi: number, bpm: number | null, text?: string): EditResult {
  const measures = score.measures.map((m, i) =>
    i === mi
      ? {
          ...m,
          tempo: bpm ? { bpm, beatUnit: frac(1, 4), metronomeShown: true, ...(text ? { text } : {}) } : undefined,
        }
      : m,
  );
  return { score: { ...score, measures }, changed: [mi] };
}

export function setRehearsal(score: Score, mi: number, text: string | null): EditResult {
  const measures = score.measures.map((m, i) => (i === mi ? { ...m, rehearsal: text || undefined } : m));
  return { score: { ...score, measures }, changed: [mi] };
}

// ---- 範囲の操作 ----

export type Clipboard = { measures: number; parts: { notes: Note[]; directions: Direction[] }[] };

const inRange = (r: Range) => (x: { partId: string; measure: number }) =>
  r.partIds.includes(x.partId) && x.measure >= r.start && x.measure < r.end;

export function copyRange(score: Score, r: Range): Clipboard {
  return {
    measures: r.end - r.start,
    parts: r.partIds.map((pid) => ({
      notes: score.notes
        .filter((n) => n.partId === pid && n.measure >= r.start && n.measure < r.end)
        .map((n) => ({ ...n, measure: n.measure - r.start })),
      directions: score.directions
        .filter((d) => d.partId === pid && d.measure >= r.start && d.measure < r.end && d.kind !== 'wedge')
        .map((d) => ({ ...d, measure: d.measure - r.start })),
    })),
  };
}

/** 範囲の音を消して全休符にする */
export function clearRange(score: Score, r: Range): EditResult {
  const hit = inRange(r);
  const notes = score.notes.filter((n) => !hit(n));
  const directions = score.directions.filter((d) => !(hit(d) && d.kind !== 'tempo'));
  for (const pid of r.partIds) {
    const part = score.parts.find((p) => p.id === pid);
    for (let mi = r.start; mi < r.end; mi++) {
      for (let s = 1; s <= (part?.staves ?? 1); s++) {
        notes.push({
          id: newId('r'),
          partId: pid,
          measure: mi,
          staff: s,
          voice: 1,
          onset: ZERO,
          duration: measureLength(score, mi),
          heads: [],
          articulations: [],
          measureRest: true,
          origin: 'edited',
        });
      }
    }
  }
  return { score: { ...score, notes, directions }, changed: range(r.start, r.end - 1) };
}

/** 貼り付け：start の小節から、選んだパートに（コピーしたパートの順に）上書きする */
export function pasteRange(score: Score, partIds: string[], start: number, clip: Clipboard): EditResult {
  const count = Math.min(clip.measures, score.measures.length - start);
  if (count <= 0) return unchanged(score, '貼り付ける場所がありません');
  const targets = partIds.slice(0, clip.parts.length);
  const r: Range = { partIds: targets, start, end: start + count };
  const hit = inRange(r);
  const slurMap = new Map<string, string>();
  const tupletMap = new Map<string, string>();
  const mapId = (m: Map<string, string>, id: string) => m.get(id) ?? (m.set(id, newId('x')), m.get(id)!);
  const added: Note[] = [];
  const addedDirs: Direction[] = [];
  targets.forEach((pid, k) => {
    for (const n of clip.parts[k].notes) {
      if (n.measure >= count) continue;
      added.push({
        ...n,
        id: newId('n'),
        partId: pid,
        measure: n.measure + start,
        heads: n.heads.map((h) => ({ ...h, id: newId('h') })),
        slurs: n.slurs?.map((s) => ({ ...s, id: mapId(slurMap, s.id) })),
        tuplets: n.tuplets?.map((t) => ({ ...t, id: mapId(tupletMap, t.id) })),
        origin: 'edited',
      });
    }
    for (const d of clip.parts[k].directions) {
      if (d.measure < count) addedDirs.push({ ...d, id: newId('d'), partId: pid, measure: d.measure + start });
    }
  });
  return {
    score: {
      ...score,
      notes: [...score.notes.filter((n) => !hit(n)), ...added],
      directions: [...score.directions.filter((d) => !(hit(d) && d.kind !== 'tempo')), ...addedDirs],
    },
    changed: range(start, start + count - 1),
  };
}

export function octaveRange(score: Score, r: Range, octaves: number): EditResult {
  const hit = inRange(r);
  const notes = score.notes.map((n) =>
    hit(n) && n.heads.length
      ? { ...n, heads: n.heads.map((h) => ({ ...h, pitch: { ...h.pitch, octave: h.pitch.octave + octaves } })) }
      : n,
  );
  return { score: { ...score, notes }, changed: range(r.start, r.end - 1) };
}

export function transposeRange(score: Score, r: Range, interval: Interval): EditResult {
  const res = transposeConcert(score, { interval, partIds: r.partIds, range: { start: r.start, end: r.end } });
  return { score: res.score, changed: 'all' };
}

/** 範囲（1つのパート）の音を、別のパートの同じ小節へ移す。移した元は全休符になる */
export function moveRangeToPart(score: Score, r: Range, targetPartId: string): EditResult {
  if (r.partIds.length !== 1) return unchanged(score, '移す元のパートを1つだけ選んでください');
  if (r.partIds[0] === targetPartId) return unchanged(score, '同じパートです');
  const clip = copyRange(score, r);
  const pasted = pasteRange(score, [targetPartId], r.start, clip);
  const cleared = clearRange(pasted.score, r);
  return { score: cleared.score, changed: range(r.start, r.end - 1) };
}

// ---- 小節 ----

function renumber(measures: MeasureMeta[]): MeasureMeta[] {
  const first = Number(measures[0]?.displayNumber);
  let n = Number.isFinite(first) ? first : 1;
  return measures.map((m, i) => {
    const out = { ...m, index: i, displayNumber: String(n) };
    if (!m.implicit) n++;
    return out;
  });
}

/** 小節を挿入する（全パート。中身は全休符） */
export function insertMeasures(score: Score, at: number, count = 1): EditResult {
  const shift = <T extends { measure: number }>(x: T): T =>
    x.measure >= at ? { ...x, measure: x.measure + count } : x;
  const added: MeasureMeta[] = Array.from({ length: count }, () => ({ index: 0, displayNumber: '' }));
  const measures = renumber([...score.measures.slice(0, at), ...added, ...score.measures.slice(at)]);
  const notes = score.notes.map(shift);
  const len = measureLength(score, Math.max(0, at - 1));
  for (const p of score.parts) {
    for (let k = 0; k < count; k++) {
      for (let s = 1; s <= p.staves; s++) {
        notes.push({
          id: newId('r'),
          partId: p.id,
          measure: at + k,
          staff: s,
          voice: 1,
          onset: ZERO,
          duration: len,
          heads: [],
          articulations: [],
          measureRest: true,
          origin: 'edited',
        });
      }
    }
  }
  const directions = score.directions.map((d) => {
    const moved = shift(d);
    return d.end && d.end.measure >= at ? { ...moved, end: { ...d.end, measure: d.end.measure + count } } : moved;
  });
  const clefs: ClefChange[] = score.clefs.map((c) =>
    c.measure >= at && !(c.measure === 0 && at === 0) ? shift(c) : c,
  );
  return { score: { ...score, measures, notes, directions, clefs }, changed: 'all' };
}

/** 小節を削除する（全パート） */
export function deleteMeasures(score: Score, start: number, end: number): EditResult {
  const count = end - start;
  if (count <= 0) return unchanged(score, '削除する小節がありません');
  if (count >= score.measures.length) return unchanged(score, 'すべての小節は削除できません');
  const keep = <T extends { measure: number }>(x: T) => x.measure < start || x.measure >= end;
  const shift = <T extends { measure: number }>(x: T): T =>
    x.measure >= end ? { ...x, measure: x.measure - count } : x;
  const removedMeta = score.measures.slice(start, end);
  const measures = [...score.measures.slice(0, start), ...score.measures.slice(end)];
  // 消した小節で拍子・調号が変わっていたら、次の小節に引き継ぐ
  const lastTime = [...removedMeta].reverse().find((m) => m.time)?.time;
  const lastKey = [...removedMeta].reverse().find((m) => m.key)?.key;
  if (measures[start]) {
    measures[start] = {
      ...measures[start],
      time: measures[start].time ?? lastTime,
      key: measures[start].key ?? lastKey,
    };
  }
  if (start === 0 && measures[0])
    measures[0] = {
      ...measures[0],
      time: measures[0].time ?? score.measures[0].time,
      key: measures[0].key ?? score.measures[0].key,
    };
  const notes = score.notes.filter(keep).map(shift);
  const directions = score.directions.filter(keep).map((d) => {
    const moved = shift(d);
    if (!d.end) return moved;
    if (d.end.measure >= end) return { ...moved, end: { ...d.end, measure: d.end.measure - count } };
    if (d.end.measure >= start)
      return {
        ...moved,
        end: { measure: start - 1 < moved.measure ? moved.measure : start - 1, onset: measureLength(score, start - 1) },
      };
    return moved;
  });
  const clefs = score.clefs
    .filter((c) => keep(c) || c.measure === 0)
    .map((c) => (c.measure >= end ? shift(c) : c.measure >= start ? { ...c, measure: start } : c));
  return { score: { ...score, measures: renumber(measures), notes, directions, clefs }, changed: 'all' };
}

/** 拍子を変える（音は詰め直さない。拍の過不足は警告になる） */
export function setTimeSignature(score: Score, mi: number, beats: number, beatType: number): EditResult {
  const measures = score.measures.map((m, i) => (i === mi ? { ...m, time: { beats, beatType } } : m));
  return { score: { ...score, measures }, changed: 'all' };
}

/** 調号を変える（実音を保つ。臨時記号が付く） */
export function setKeySignature(score: Score, mi: number, fifths: number): EditResult {
  const mode = keyAt(score, mi).mode;
  const measures = score.measures.map((m, i) => (i === mi ? { ...m, key: { fifths, mode } } : m));
  return { score: { ...score, measures }, changed: 'all' };
}

// ---- 拍の過不足 ----

export type FillIssue = { partId: string; measure: number; staff: number; voice: number; over: Fraction };

/** 拍があふれている声部（警告用）。足りない声部は fillMeasures で休符を足す */
export function overfullVoices(score: Score, measures?: number[]): FillIssue[] {
  const only = measures ? new Set(measures) : undefined;
  const ends = new Map<string, { n: Note; end: Fraction }>();
  for (const n of score.notes) {
    if (n.grace || (only && !only.has(n.measure))) continue;
    const key = `${n.partId}|${n.measure}|${n.staff}|${n.voice}`;
    const end = add(n.onset, n.duration);
    const cur = ends.get(key);
    if (!cur || cmp(end, cur.end) > 0) ends.set(key, { n, end });
  }
  const out: FillIssue[] = [];
  for (const { n, end } of ends.values()) {
    const len = measureLength(score, n.measure);
    if (cmp(end, len) > 0)
      out.push({ partId: n.partId, measure: n.measure, staff: n.staff, voice: n.voice, over: sub(end, len) });
  }
  return out;
}

/** 指定した小節で、1声部目の拍が足りないところを休符で埋める（弱起など implicit の小節は除く） */
export function fillMeasures(score: Score, measures: number[]): Score {
  const added: Note[] = [];
  for (const mi of measures) {
    if (score.measures[mi]?.implicit) continue;
    const len = measureLength(score, mi);
    for (const p of score.parts) {
      for (let s = 1; s <= p.staves; s++) {
        const v = voiceOf(score, { partId: p.id, measure: mi, staff: s, voice: 1 });
        let cursor = ZERO;
        for (const n of v) {
          if (lt(cursor, n.onset))
            added.push(...makeRests({ partId: p.id, measure: mi, staff: s, voice: 1 }, cursor, sub(n.onset, cursor)));
          const e = add(n.onset, n.duration);
          if (cmp(e, cursor) > 0) cursor = e;
        }
        if (v.length && lt(cursor, len))
          added.push(...makeRests({ partId: p.id, measure: mi, staff: s, voice: 1 }, cursor, sub(len, cursor)));
      }
    }
  }
  return added.length ? { ...score, notes: [...score.notes, ...added] } : score;
}

/** MIDI番号の音を、調に合わせて綴る（調号どおり → 変化記号なし → ♯） */
export function spellMidi(midiNumber: number, key: Key): Pitch {
  // 半音下の音から半音上げた綴りを使う
  const below = spellFromDiatonic(Math.round(((midiNumber - 13) * 7) / 12), midiNumber - 1);
  const p = below ? spellSemitone(below, 1, key) : { step: 'C' as Step, alter: 0 as const, octave: 4 };
  return midi(p) === midiNumber ? p : (spellFromDiatonic(Math.round(((midiNumber - 12) * 7) / 12), midiNumber) ?? p);
}

/** 鍵盤で入力：その高さの音にする（綴りは調号に合わせる）。休符なら音にして、次へ進む */
export function enterMidi(score: Score, noteId: string, midiNumber: number): EditResult {
  const n = findNote(score, noteId);
  if (!n) return unchanged(score, '音符が選ばれていません');
  const head: NoteHead = { id: n.heads[0]?.id ?? newId('h'), pitch: spellMidi(midiNumber, keyAt(score, n.measure)) };
  const updated: Note = { ...n, heads: [head], measureRest: undefined, origin: editedOrigin(n) };
  if (n.measureRest) updated.notation = notationFor(n.duration) ?? undefined;
  const next = mapNotes(score, new Set([n.id]), () => updated);
  const after = nextEvent(next, updated);
  return { score: next, changed: [n.measure], select: { kind: 'note', noteId: (after ?? updated).id } };
}

export type Alternative = { pitch: Pitch; sourceNoteId: string };

/**
 * 旋律を取り出して作った音（derivedFrom あり）について、元のパートで同じ位置から鳴っている別の音の候補。
 * 高い順。今の音と同じ高さのものは除く
 */
export function melodyAlternatives(score: Score, noteId: string): Alternative[] {
  const n = findNote(score, noteId);
  const from = n?.derivedFrom;
  if (!n || !from) return [];
  const current = new Set(n.heads.map((h) => midi(h.pitch)));
  const seen = new Set<number>();
  const out: Alternative[] = [];
  for (const s of score.notes) {
    if (s.partId !== from.sourcePartId || s.measure !== n.measure || s.grace || cmp(s.onset, n.onset) !== 0) continue;
    for (const h of s.heads) {
      const m = midi(h.pitch);
      if (current.has(m) || seen.has(m)) continue;
      seen.add(m);
      out.push({ pitch: h.pitch, sourceNoteId: s.id });
    }
  }
  return out.sort((a, b) => midi(b.pitch) - midi(a.pitch));
}

/** 取り出した旋律の音を、元のパートの別の音に差し替える（音の長さはそのまま） */
export function applyAlternative(score: Score, noteId: string, alt: Alternative): EditResult {
  const n = findNote(score, noteId);
  if (!n?.derivedFrom) return unchanged(score, '旋律を取り出して作った音ではありません');
  const head: NoteHead = { id: n.heads[0]?.id ?? newId('h'), pitch: alt.pitch };
  const updated: Note = {
    ...n,
    heads: [head],
    derivedFrom: { ...n.derivedFrom, sourceNoteIds: [alt.sourceNoteId] },
    origin: editedOrigin(n),
  };
  return { score: mapNotes(score, new Set([n.id]), () => updated), changed: [n.measure] };
}
