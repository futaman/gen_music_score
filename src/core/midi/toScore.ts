// MIDI → 内部データ。音の長さのそろえ（16分音符か、拍ごとに8分3連符）、調の推定と綴り、声部の分離、強弱の推定。
// 仕様：docs/spec.md「入力」（MIDI）。MusicXML を経ずに内部データへ直接変換する（後の処理は同じ）

import { spellMidi } from '../edit/commands';
import { getInstrument, guessInstrument, INSTRUMENTS } from '../instruments';
import { notationFor } from '../model/notation';
import { newId, splitDuration } from '../model/rhythm';
import type { ClefChange, Direction, MeasureMeta, Note, NoteType, Part, Score, Tuplet } from '../model/types';
import type { ImportResult } from '../musicxml/import';
import type { ImportWarning } from '../musicxml/errors';
import { ImportError } from '../musicxml/errors';
import { frac } from '../theory/fraction';
import type { Key } from '../theory/key';
import { parseMidi, type MidiFile, type MidiNote } from './parse';

/** 内部の時間の単位：全音符の 1/48（16分音符 = 3、8分3連符 = 4） */
const U = 48;
const BEAT = 12; // 4分音符

type Measure = { start: number; length: number; beats: number; beatType: number };
type Ev = { start: number; end: number; pitches: number[]; velocity: number };

/** GM の音色番号 → 楽器（代表的なものだけ） */
function instrumentForProgram(program: number | undefined): string {
  if (program === undefined) return 'piano';
  const exact = INSTRUMENTS.find((i) => i.midiProgram === program);
  if (exact) return exact.id;
  if (program < 8) return 'piano';
  if (program >= 48 && program < 52) return 'violin'; // 弦楽合奏
  return 'unknown';
}

/** 長調・短調の音名の重み（Krumhansl） */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** 音の長さの音名ごとの合計から調を推定する */
export function estimateKey(notes: { pitch: number; duration: number }[]): Key {
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[n.pitch % 12] += n.duration;
  const corr = (profile: number[], tonic: number) => {
    const xs = hist.map((_, i) => hist[(i + tonic) % 12]);
    const mx = xs.reduce((a, b) => a + b, 0) / 12;
    const my = profile.reduce((a, b) => a + b, 0) / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      num += (xs[i] - mx) * (profile[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (profile[i] - my) ** 2;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  };
  let best = { fifths: 0, mode: 'major' as Key['mode'], r: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const r = corr(mode === 'major' ? MAJOR : MINOR, tonic);
      // 主音 → 五度圏の位置（短調は平行長調の調号）
      const majorTonic = mode === 'major' ? tonic : (tonic + 3) % 12;
      let fifths = (majorTonic * 7) % 12;
      if (fifths > 6) fifths -= 12; // ♭系を優先（F♯ と G♭ は G♭、6♯ は残す）
      if (r > best.r) best = { fifths, mode, r };
    }
  }
  return { fifths: best.fifths, mode: best.mode };
}

function buildMeasures(midi: MidiFile, lastTick: number): Measure[] {
  const toU = (tick: number) => Math.round((tick * BEAT) / midi.division);
  const lastU = toU(lastTick);
  const sigs = midi.timeSigs.length ? midi.timeSigs : [{ tick: 0, beats: 4, beatType: 4 }];
  const measures: Measure[] = [];
  let pos = 0;
  let sig = sigs[0];
  let next = 1;
  while (pos < lastU || measures.length === 0) {
    while (next < sigs.length && toU(sigs[next].tick) <= pos) sig = sigs[next++];
    let length = Math.round((sig.beats * U) / sig.beatType);
    // 拍子の変わり目が小節の途中にあれば、そこで小節を切る（弱起など）
    if (next < sigs.length && toU(sigs[next].tick) < pos + length) length = toU(sigs[next].tick) - pos;
    if (length <= 0) length = U;
    measures.push({ start: pos, length, beats: sig.beats, beatType: sig.beatType });
    pos += length;
  }
  return measures;
}

/** 拍（4分音符）ごとに、16分音符と8分3連符のどちらの格子に合うかを決める */
function tripletBeats(points: number[]): Set<number> {
  const byBeat = new Map<number, number[]>();
  for (const x of points) {
    const b = Math.floor(x / BEAT);
    const r = x - b * BEAT;
    if (r > 0.01 && r < BEAT - 0.01) byBeat.set(b, [...(byBeat.get(b) ?? []), r]);
  }
  const out = new Set<number>();
  for (const [b, rs] of byBeat) {
    const err = (g: number) => rs.reduce((s, r) => s + Math.abs(r - Math.round(r / g) * g), 0);
    if (err(4) + 0.5 < err(3)) out.add(b);
  }
  return out;
}

const snap = (x: number, triplets: Set<number>) => {
  const g = triplets.has(Math.floor(x / BEAT)) ? 4 : 3;
  return Math.round(x / g) * g;
};

/** 同時に始まり同時に終わる音を和音にまとめ、2つまでの声部に分ける（あふれたら前の音を切る） */
function voices(evs: Ev[], polyphonic: boolean): Ev[][] {
  const chords = new Map<string, Ev>();
  for (const e of evs) {
    const k = `${e.start}|${e.end}`;
    const c = chords.get(k);
    if (c) c.pitches.push(...e.pitches);
    else chords.set(k, { ...e, pitches: [...e.pitches] });
  }
  const list = [...chords.values()].sort(
    (a, b) => a.start - b.start || Math.max(...b.pitches) - Math.max(...a.pitches),
  );
  const vs: Ev[][] = polyphonic ? [[], []] : [[]];
  for (const c of list) {
    if (!polyphonic) c.pitches = [Math.max(...c.pitches)];
    const free = vs.find((v) => !v.length || v[v.length - 1].end <= c.start);
    const v = free ?? vs[0];
    const last = v[v.length - 1];
    if (last && last.end > c.start) {
      if (last.start === c.start) {
        // 同時に始まる長さ違いの音：短い方にそろえて和音にする
        last.pitches.push(...c.pitches.filter((p) => !last.pitches.includes(p)));
        last.end = Math.min(last.end, c.end);
        continue;
      }
      last.end = c.start;
    }
    v.push(c);
  }
  return vs.filter((v) => v.length);
}

type Seg = { start: number; end: number; ev?: Ev; tieStart: boolean; tieStop: boolean };

/** 声部の音を小節ごとの音符・休符にする（小節線・3連符の拍でタイで分ける） */
function toNotes(
  v: Ev[],
  vi: number,
  part: Part,
  staff: number,
  measures: Measure[],
  triplets: Set<number>,
  key: (mi: number) => Key,
  fillRests: boolean,
): Note[] {
  const out: Note[] = [];
  measures.forEach((m, mi) => {
    const mEnd = m.start + m.length;
    const inside = v.filter((e) => e.end > m.start && e.start < mEnd);
    if (!inside.length && !fillRests) return;
    // 小節の中の切れ目：音の始まり・終わり、3連符の拍の端
    const segs: Seg[] = [];
    let pos = m.start;
    for (const e of inside) {
      const s = Math.max(e.start, m.start);
      if (s > pos) segs.push({ start: pos, end: s, tieStart: false, tieStop: false });
      segs.push({ start: s, end: Math.min(e.end, mEnd), ev: e, tieStop: e.start < m.start, tieStart: e.end > mEnd });
      pos = Math.min(e.end, mEnd);
    }
    if (pos < mEnd) segs.push({ start: pos, end: mEnd, tieStart: false, tieStop: false });
    const pieces: Seg[] = [];
    for (const sg of segs) {
      const cuts = [sg.start];
      for (let b = Math.floor(sg.start / BEAT) + 1; b * BEAT < sg.end; b++)
        if (triplets.has(b) || triplets.has(b - 1)) cuts.push(b * BEAT);
      cuts.push(sg.end);
      for (let i = 0; i + 1 < cuts.length; i++)
        pieces.push({
          ...sg,
          start: cuts[i],
          end: cuts[i + 1],
          tieStop: i === 0 ? sg.tieStop : !!sg.ev,
          tieStart: i + 2 === cuts.length ? sg.tieStart : !!sg.ev,
        });
    }
    // 3連符の拍は拍ごとに1つの連符にまとめる
    const tupletOf = new Map<number, Tuplet>();
    for (const pc of pieces) {
      const beat = Math.floor(pc.start / BEAT);
      const inTriplet = triplets.has(beat) && pc.end - pc.start < BEAT;
      const d = pc.end - pc.start;
      const durations: number[] = inTriplet ? [d] : splitDuration(frac(d, U)).map((f) => (f.num * U) / f.den);
      let at = pc.start;
      durations.forEach((du, k) => {
        const onset = frac(at - m.start, U);
        const duration = frac(du, U);
        let notation: Note['notation'];
        let tuplets: Tuplet[] | undefined;
        if (inTriplet) {
          const type: NoteType = du === 4 ? 'eighth' : du === 8 ? 'quarter' : 'eighth';
          notation = { type, dots: 0 };
          let t = tupletOf.get(beat);
          if (!t) tupletOf.set(beat, (t = { id: newId('t'), actual: 3, normal: 2, normalType: 'eighth' }));
          tuplets = [t];
        } else notation = notationFor(duration) ?? undefined;
        const tie = pc.ev
          ? {
              ...(k > 0 || pc.tieStop ? { stop: true } : {}),
              ...(k < durations.length - 1 || pc.tieStart ? { start: true } : {}),
            }
          : undefined;
        out.push({
          id: newId(pc.ev ? 'n' : 'r'),
          partId: part.id,
          measure: mi,
          staff,
          voice: vi + 1,
          onset,
          duration,
          notation,
          tuplets,
          heads: pc.ev
            ? [...pc.ev.pitches]
                .sort((a, b) => a - b)
                .map((p) => ({
                  id: newId('h'),
                  pitch: spellMidi(p, key(mi)),
                  ...(tie && Object.keys(tie).length ? { tie } : {}),
                }))
            : [],
          articulations: [],
          origin: 'source',
        });
        at += du;
      });
    }
    // 連符の始まり・終わりの印（同じ id の最初と最後）
    for (const t of tupletOf.values()) {
      const members = out.filter((n) => n.measure === mi && n.tuplets?.[0] === t);
      members.forEach((n, i) => {
        n.tuplets = [
          { ...t, ...(i === 0 ? { start: true } : {}), ...(i === members.length - 1 ? { stop: true } : {}) },
        ];
      });
    }
  });
  return out;
}

const DYN: [number, string][] = [
  [40, 'pp'],
  [55, 'p'],
  [70, 'mp'],
  [85, 'mf'],
  [100, 'f'],
  [128, 'ff'],
];

/** MIDI ファイルを内部データにする */
export function importMidi(bytes: Uint8Array, fileName = ''): ImportResult {
  return importParsedMidi(parseMidi(bytes), fileName);
}

/** 読んだ MIDI（parseMidi の結果）を内部データにする */
export function importParsedMidi(midi: MidiFile, fileName = ''): ImportResult {
  const warnings: ImportWarning[] = [
    {
      code: 'other',
      message:
        'MIDIから推定した楽譜です。音の長さは16分音符（拍によっては8分3連符）単位にそろえ、♯・♭は調から決め、強弱は音の強さから推定しています。',
    },
  ];
  const drums = midi.notes.filter((n) => n.channel === 9);
  if (drums.length)
    warnings.push({ code: 'other', message: `打楽器（チャンネル10）の${drums.length}音は読み込みませんでした。` });
  const notes = midi.notes.filter((n) => n.channel !== 9);
  if (!notes.length) throw new ImportError('empty', 'MIDIファイルに音がありません。');

  const toU = (tick: number) => (tick * BEAT) / midi.division;
  const lastTick = Math.max(...notes.map((n) => n.end));
  const measures = buildMeasures(midi, lastTick);
  const measureAt = (u: number) => {
    let i = measures.findIndex((m) => m.start + m.length > u);
    if (i < 0) i = measures.length - 1;
    return i;
  };

  // 調：調号の印があれば使い、なければ推定
  const keyEvents = midi.keySigs.length
    ? midi.keySigs.map((k) => ({
        measure: measureAt(toU(k.tick)),
        key: { fifths: k.fifths, mode: k.minor ? 'minor' : 'major' } as Key,
      }))
    : [{ measure: 0, key: estimateKey(notes.map((n) => ({ pitch: n.pitch, duration: n.end - n.tick }))) }];
  const keyAt = (mi: number) => {
    let k = keyEvents[0].key;
    for (const e of keyEvents) if (e.measure <= mi) k = e.key;
    return k;
  };

  // パート：トラック × チャンネル
  const groups = new Map<string, MidiNote[]>();
  for (const n of notes) {
    const k = `${n.track}|${n.channel}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const parts: Part[] = [];
  const allNotes: Note[] = [];
  const directions: Direction[] = [];
  const clefs: ClefChange[] = [];
  let pi = 0;
  const ordered = [...groups].sort(([a], [b]) => {
    const [ta, ca] = a.split('|').map(Number);
    const [tb, cb] = b.split('|').map(Number);
    return ta - tb || ca - cb;
  });
  for (const [k, ns] of ordered) {
    const [track, channel] = k.split('|').map(Number);
    const name = midi.trackNames.get(track) || '';
    const byName = name ? guessInstrument({ partName: name }) : undefined;
    const def = byName && byName.id !== 'unknown' ? byName : getInstrument(instrumentForProgram(midi.programs.get(k)));
    const part: Part = {
      id: `P${++pi}`,
      name: name || def.name.ja,
      abbr: def.abbr,
      instrumentId: def.id,
      staves: def.staves,
    };
    parts.push(part);
    void channel;

    // 時間をそろえる
    const raw = ns.map((n) => ({ s: toU(n.tick), e: toU(n.end), n }));
    const trip = tripletBeats(raw.flatMap((r) => [r.s, r.e]));
    const evs: Ev[] = [];
    for (const r of raw) {
      const s = snap(r.s, trip);
      let e = snap(r.e, trip);
      if (e <= s) e = s + (trip.has(Math.floor(s / BEAT)) ? 4 : 3);
      evs.push({ start: s, end: e, pitches: [r.n.pitch], velocity: r.n.velocity });
    }
    for (let st = 1; st <= part.staves; st++) {
      const mine = part.staves > 1 ? evs.filter((e) => (st === 1 ? e.pitches[0] >= 60 : e.pitches[0] < 60)) : evs;
      const vs = voices(mine, def.polyphonic);
      if (!vs.length) vs.push([]);
      vs.forEach((v, vi) => allNotes.push(...toNotes(v, vi, part, st, measures, trip, keyAt, vi === 0)));
      const clef = part.staves > 1 && st === 2 ? 'F4' : def.clefs.default;
      const sign = clef.replace(/\d+$/, '') as ClefChange['sign'];
      clefs.push({
        partId: part.id,
        staff: st,
        measure: 0,
        onset: frac(0),
        sign,
        line: Number(clef.slice(sign.length)) || 2,
      });
    }

    // 強弱：小節ごとの音の強さの平均が段階を変えたら書く
    let last = '';
    measures.forEach((m, mi) => {
      const vel = evs.filter((e) => e.start >= m.start && e.start < m.start + m.length).map((e) => e.velocity);
      if (!vel.length) return;
      const avg = vel.reduce((a, b) => a + b, 0) / vel.length;
      const dyn = DYN.find(([max]) => avg < max)![1];
      if (dyn !== last) {
        directions.push({
          id: newId('d'),
          partId: part.id,
          measure: mi,
          onset: frac(0),
          staff: 1,
          kind: 'dynamic',
          value: dyn,
          placement: 'below',
        });
        last = dyn;
      }
    });
  }

  // 同じ名前のパート（名前のないトラックのヴァイオリン2つなど）には番号を付ける
  const count = new Map<string, number>();
  for (const p of parts) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const p of parts) {
    if ((count.get(p.name) ?? 0) < 2) continue;
    const k = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, k);
    p.name = `${p.name} ${k}`;
  }

  const tempoAt = (u: number) => {
    let us = 500000;
    for (const t of midi.tempos) if (toU(t.tick) <= u) us = t.usPerQuarter;
    return Math.round(60_000_000 / us);
  };
  const metas: MeasureMeta[] = measures.map((m, i) => {
    const prev = measures[i - 1];
    const meta: MeasureMeta = { index: i, displayNumber: String(i + 1) };
    if (!prev || prev.beats !== m.beats || prev.beatType !== m.beatType)
      meta.time = { beats: m.beats, beatType: m.beatType };
    if (i === 0 || keyEvents.some((e) => e.measure === i && i > 0)) meta.key = keyAt(i);
    const bpm = tempoAt(m.start);
    if (i === 0 || bpm !== tempoAt(prev!.start)) meta.tempo = { bpm, beatUnit: frac(1, 4) };
    return meta;
  });
  // 弱起：最初の小節が拍子どおりより短い、または次の小節で拍子が変わる短い小節（MuseScore は弱起を 1/4 などで書く）
  const [m0, m1] = measures;
  const nominal = (m: Measure) => Math.round((m.beats * U) / m.beatType);
  if (
    m1 &&
    (m0.length < nominal(m0) || (m0.length < nominal(m1) && (m0.beats !== m1.beats || m0.beatType !== m1.beatType)))
  ) {
    metas[0].implicit = true;
    metas[0].time = { beats: m1.beats, beatType: m1.beatType };
    delete metas[1].time;
    metas.forEach((m, i) => (m.displayNumber = String(i)));
  }

  const title =
    (midi.trackNames.get(0) && !notes.some((n) => n.track === 0) ? midi.trackNames.get(0) : '') ||
    fileName.replace(/\.(mid|midi)$/i, '');
  const score: Score = {
    schemaVersion: 1,
    id: newId('score-'),
    title,
    composer: '',
    parts,
    measures: metas,
    notes: allNotes,
    directions,
    clefs,
  };
  return { score, warnings, ignored: [], software: 'MIDI' };
}
