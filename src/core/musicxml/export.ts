// 内部データ → MusicXML（score-partwise 4.0、総譜1ファイル）。
// 移調楽器のパートは記譜音＋<transpose> で書く（MuseScore などの標準）。

import { getInstrument, partTransposition } from '../instruments';
import { notationFor, tupletRatio } from '../model/notation';
import type { ClefChange, Direction, MeasureMeta, Note, NoteHead, Part, Score, Transposition } from '../model/types';
import { add, cmp, eq, frac, isZero, lcm, sub, toDivisions, ZERO, type Fraction } from '../theory/fraction';
import { AlterOverflowError, invert, transposePitch } from '../theory/interval';
import { keyAlterations, normalizeKey, transposeKey } from '../theory/key';
import { simplifyEnharmonic, type Pitch } from '../theory/pitch';
import { el, prettyXml, serializeNode } from './xml';

export type ExportOptions = { software?: string; date?: string };

export function exportMusicXml(score: Score, opts: ExportOptions = {}): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  out.push('<score-partwise version="4.0">');
  if (score.title) out.push(el('work', {}, [el('work-title', {}, score.title)]));
  if (score.movementTitle) out.push(el('movement-title', {}, score.movementTitle));
  const ident: string[] = [];
  if (score.composer) ident.push(el('creator', { type: 'composer' }, score.composer));
  ident.push(
    el('encoding', {}, [
      el('software', {}, opts.software ?? 'gen_music_score'),
      el('encoding-date', {}, opts.date ?? new Date().toISOString().slice(0, 10)),
    ]),
  );
  out.push(el('identification', {}, ident));
  out.push(partList(score));

  const notesByPart = groupBy(score.notes, (n) => n.partId);
  const dirsByPart = groupBy(score.directions, (d) => d.partId);
  const clefsByPart = groupBy(score.clefs, (c) => c.partId);
  score.parts.forEach((part, pi) => {
    out.push(
      writePart(
        score,
        part,
        pi,
        notesByPart.get(part.id) ?? [],
        dirsByPart.get(part.id) ?? [],
        clefsByPart.get(part.id) ?? [],
      ),
    );
  });
  out.push('</score-partwise>');
  return prettyXml(out.join(''));
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    let arr = m.get(k);
    if (!arr) m.set(k, (arr = []));
    arr.push(it);
  }
  return m;
}

function partList(score: Score): string {
  const items: string[] = [];
  const groups = score.passthrough?.partGroups ?? [];
  score.parts.forEach((p, i) => {
    for (const g of groups.filter((g) => g.attrs['data-before-part'] === String(i))) items.push(serializeGroup(g));
    const def = getInstrument(p.instrumentId);
    const instId = `${p.id}-I1`;
    const children = [el('part-name', {}, p.name)];
    if (p.abbr) children.push(el('part-abbreviation', {}, p.abbr));
    const inst = [el('instrument-name', {}, p.source?.instrumentName ?? def.name.en)];
    const sound = p.source?.instrumentSound ?? def.match.sounds[0];
    if (sound) inst.push(el('instrument-sound', {}, sound));
    children.push(el('score-instrument', { id: instId }, inst));
    children.push(
      el('midi-instrument', { id: instId }, [el('midi-program', {}, (p.source?.midiProgram ?? def.midiProgram) + 1)]),
    );
    items.push(el('score-part', { id: p.id }, children));
  });
  for (const g of groups.filter((g) => Number(g.attrs['data-before-part']) >= score.parts.length))
    items.push(serializeGroup(g));
  return el('part-list', {}, items);
}

function serializeGroup(g: { tag: string; attrs: Record<string, string>; children: (typeof g | string)[] }) {
  const attrs = { ...g.attrs };
  delete attrs['data-before-part'];
  return serializeNode({ ...g, attrs } as Parameters<typeof serializeNode>[0]);
}

// ---------------------------------------------------------------------------

/** パート内のすべての位置・長さを整数で表せる divisions を求める */
function chooseDivisions(values: Fraction[]): number {
  let d = 1;
  for (const v of values) {
    if (v.num === 0) continue;
    // v * 4 * d が整数になる最小の d の倍数
    const need = v.den / gcd(v.den, 4 * v.num);
    d = lcm(d, need);
  }
  return d;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

const ACCIDENTAL_NAMES: Record<number, string> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};

function writtenPitch(p: Pitch, t: Transposition | null): Pitch {
  if (!t) return p;
  try {
    return transposePitch(p, invert(t));
  } catch (e) {
    if (e instanceof AlterOverflowError) return simplifyEnharmonic(transposePitch(simplifyEnharmonic(p), invert(t)));
    throw e;
  }
}

function writePart(
  score: Score,
  part: Part,
  partIndex: number,
  notes: Note[],
  dirs: Direction[],
  clefs: ClefChange[],
): string {
  const t = partTransposition(part);
  const def = getInstrument(part.instrumentId);

  const values: Fraction[] = [];
  for (const n of notes) values.push(n.onset, n.duration);
  for (const d of dirs) values.push(d.onset, ...(d.end ? [d.end.onset] : []));
  for (const c of clefs) values.push(c.onset);
  const divisions = chooseDivisions(values);
  const dur = (f: Fraction) => {
    const v = toDivisions(f, divisions);
    if (v === null) throw new Error(`divisions ${divisions} で表せない長さ ${f.num}/${f.den}`);
    return v;
  };

  const notesByMeasure = groupBy(notes, (n) => String(n.measure));
  const dirsByMeasure = groupBy(dirs, (d) => String(d.measure));
  const dirEndsByMeasure = groupBy(
    dirs.filter((d) => d.end),
    (d) => String(d.end!.measure),
  );
  const clefsByMeasure = groupBy(clefs, (c) => String(c.measure));

  let concertKey = score.measures[0]?.key ?? { fifths: 0, mode: 'major' as const };
  const lines: string[] = [];
  const slurNumbers = new Map<string, number>();
  const usedSlurNumbers = new Set<number>();
  const wedgeNumbers = new Map<string, number>();

  score.measures.forEach((meta, mi) => {
    if (meta.key) concertKey = meta.key;
    const writtenKey = t && !def.unpitched ? normalizeKey(transposeKey(concertKey, invert(t))) : concertKey;
    const body: string[] = [];
    let cursor: Fraction = ZERO;
    const moveTo = (target: Fraction) => {
      const c = cmp(target, cursor);
      if (c > 0) body.push(el('forward', {}, [el('duration', {}, dur(sub(target, cursor)))]));
      if (c < 0) body.push(el('backup', {}, [el('duration', {}, dur(sub(cursor, target)))]));
      cursor = target;
    };

    // 小節頭の attributes
    const attrs: string[] = [];
    const mClefs = clefsByMeasure.get(String(mi)) ?? [];
    const headClefs = mClefs.filter((c) => isZero(c.onset));
    if (mi === 0) attrs.push(el('divisions', {}, divisions));
    if (meta.key || mi === 0) {
      const k = [el('fifths', {}, writtenKey.fifths)];
      if (writtenKey.mode) k.push(el('mode', {}, writtenKey.mode));
      attrs.push(el('key', {}, k));
    }
    if (meta.time) {
      const tAttrs = meta.time.symbol ? { symbol: meta.time.symbol } : {};
      attrs.push(el('time', tAttrs, [el('beats', {}, meta.time.beats), el('beat-type', {}, meta.time.beatType)]));
    }
    if (mi === 0 && part.staves > 1) attrs.push(el('staves', {}, part.staves));
    for (const c of headClefs) attrs.push(clefXml(c, part.staves));
    if (mi === 0 && t) attrs.push(transposeXml(t));
    if (attrs.length) body.push(el('attributes', {}, attrs));

    // 左の小節線（繰り返しの始まり・括弧の始まり）
    const left: string[] = [];
    if (meta.ending && meta.ending.type.startsWith('start')) {
      left.push(el('ending', { number: meta.ending.numbers, type: 'start' }));
    }
    if (meta.repeat === 'start' || meta.repeat === 'both') left.push(el('repeat', { direction: 'forward' }));
    if (left.length) {
      const style = meta.repeat === 'start' || meta.repeat === 'both' ? [el('bar-style', {}, 'heavy-light')] : [];
      body.push(el('barline', { location: 'left' }, [...style, ...left]));
    }

    // 方向記号（テンポ・記号）を位置ごとに並べる
    type Event = { onset: Fraction; xml: () => string };
    const events: Event[] = [];
    if (partIndex === 0) {
      if (meta.rehearsal)
        events.push({ onset: ZERO, xml: () => directionXml([el('rehearsal', {}, meta.rehearsal!)], 1, 'above') });
      if (meta.jumps?.includes('segno'))
        events.push({ onset: ZERO, xml: () => directionXml([el('segno')], 1, 'above') });
      if (meta.jumps?.includes('coda')) events.push({ onset: ZERO, xml: () => directionXml([el('coda')], 1, 'above') });
      if (meta.tempo) events.push({ onset: ZERO, xml: () => tempoXml(meta.tempo!, 1) });
    }
    for (const d of dirsByMeasure.get(String(mi)) ?? []) {
      events.push({ onset: d.onset, xml: () => directionStartXml(d, wedgeNumbers) });
    }
    for (const d of dirEndsByMeasure.get(String(mi)) ?? []) {
      events.push({ onset: d.end!.onset, xml: () => directionEndXml(d, wedgeNumbers) });
    }
    for (const c of mClefs.filter((c) => !isZero(c.onset))) {
      events.push({ onset: c.onset, xml: () => el('attributes', {}, [clefXml(c, part.staves)]) });
    }
    events.sort((a, b) => cmp(a.onset, b.onset));
    let ei = 0;
    const flushEvents = (upTo: Fraction | null) => {
      while (ei < events.length && (upTo === null || cmp(events[ei].onset, upTo) <= 0)) {
        moveTo(events[ei].onset);
        body.push(events[ei].xml());
        ei++;
      }
    };

    // 声部ごとに音符を書く
    const mNotes = notesByMeasure.get(String(mi)) ?? [];
    const voices = groupBy(mNotes, (n) => `${n.staff}/${n.voice}`);
    const voiceKeys = [...voices.keys()].sort((a, b) => {
      const [sa, va] = a.split('/').map(Number);
      const [sb, vb] = b.split('/').map(Number);
      return sa - sb || va - vb;
    });
    const accidentals = accidentalPlanner(mNotes, writtenKey.fifths, t);

    voiceKeys.forEach((vk, vi) => {
      const vNotes = voices
        .get(vk)!
        .slice()
        .sort((a, b) => cmp(a.onset, b.onset) || Number(!a.grace) - Number(!b.grace));
      if (vi > 0) moveTo(ZERO);
      for (const n of vNotes) {
        if (vi === 0) flushEvents(n.onset);
        moveTo(n.onset);
        body.push(noteXml(n, t, dur, accidentals, slurNumbers, usedSlurNumbers));
        if (!n.grace) cursor = add(n.onset, n.duration);
      }
    });
    flushEvents(null);

    // 右の小節線と、D.C. などの指示
    if (partIndex === 0) {
      const sounds: Record<string, string> = {};
      if (meta.jumps?.includes('dacapo')) sounds.dacapo = 'yes';
      if (meta.jumps?.includes('dalsegno')) sounds.dalsegno = 'segno';
      if (meta.jumps?.includes('fine')) sounds.fine = 'yes';
      if (meta.jumps?.includes('tocoda')) sounds.tocoda = 'coda';
      if (Object.keys(sounds).length) body.push(el('sound', sounds));
    }
    const right: string[] = [];
    const isEnd = meta.repeat === 'end' || meta.repeat === 'both';
    if (meta.barlineRight) right.push(el('bar-style', {}, meta.barlineRight));
    else if (isEnd) right.push(el('bar-style', {}, 'light-heavy'));
    if (meta.ending && meta.ending.type !== 'start') {
      const type = meta.ending.type.endsWith('discontinue') ? 'discontinue' : 'stop';
      right.push(el('ending', { number: meta.ending.numbers, type }));
    }
    if (isEnd)
      right.push(el('repeat', { direction: 'backward', ...(meta.repeatTimes ? { times: meta.repeatTimes } : {}) }));
    if (right.length) body.push(el('barline', { location: 'right' }, right));

    const mAttrs: Record<string, string> = { number: meta.displayNumber };
    if (meta.implicit) mAttrs.implicit = 'yes';
    lines.push(
      el(
        'measure',
        mAttrs,
        body.length ? body : [el('forward', {}, [el('duration', {}, dur(measureLength(score, mi)))])],
      ),
    );
  });
  return el('part', { id: part.id }, lines);
}

function measureLength(score: Score, mi: number): Fraction {
  for (let i = mi; i >= 0; i--) {
    const t = score.measures[i].time;
    if (t) return frac(t.beats, t.beatType);
  }
  return frac(1);
}

function clefXml(c: ClefChange, staves: number): string {
  const children = [el('sign', {}, c.sign)];
  if (c.sign !== 'percussion' && c.sign !== 'none') children.push(el('line', {}, c.line));
  if (c.octaveChange) children.push(el('clef-octave-change', {}, c.octaveChange));
  return el('clef', staves > 1 || c.staff > 1 ? { number: c.staff } : {}, children);
}

function transposeXml(t: Transposition): string {
  // 1オクターブ以上は octave-change に分ける（コントラバスなど）
  const oct = Math.trunc(t.chromatic / 12);
  const children = [el('diatonic', {}, t.diatonic - 7 * oct), el('chromatic', {}, t.chromatic - 12 * oct)];
  if (oct) children.push(el('octave-change', {}, oct));
  return el('transpose', {}, children);
}

function directionXml(types: string[], staff: number, placement?: string, extra: string[] = []): string {
  const children = types.map((t) => el('direction-type', {}, [t]));
  if (staff !== 1) children.push(el('staff', {}, staff));
  children.push(...extra);
  return el('direction', placement ? { placement } : {}, children);
}

const BEAT_UNIT_NAMES: [Fraction, string, number][] = [
  [frac(1, 1), 'whole', 0],
  [frac(3, 4), 'half', 1],
  [frac(1, 2), 'half', 0],
  [frac(3, 8), 'quarter', 1],
  [frac(1, 4), 'quarter', 0],
  [frac(3, 16), 'eighth', 1],
  [frac(1, 8), 'eighth', 0],
  [frac(1, 16), '16th', 0],
];

function tempoXml(tempo: NonNullable<MeasureMeta['tempo']>, staff: number): string {
  const types: string[] = [];
  if (tempo.text) types.push(el('words', {}, tempo.text));
  const unit = BEAT_UNIT_NAMES.find(([v]) => eq(v, tempo.beatUnit)) ?? BEAT_UNIT_NAMES[4];
  if (tempo.metronomeShown) {
    const m = [el('beat-unit', {}, unit[1])];
    if (unit[2]) m.push(el('beat-unit-dot'));
    m.push(el('per-minute', {}, tempo.bpm));
    types.push(el('metronome', {}, m));
  }
  // <sound tempo> は4分音符あたりの数
  const quarterBpm = (tempo.bpm * tempo.beatUnit.num * 4) / tempo.beatUnit.den;
  const sound = el('sound', { tempo: Math.round(quarterBpm * 1000) / 1000 });
  if (!types.length) types.push(el('words'));
  return directionXml(types, staff, tempo.placement ?? 'above', [sound]);
}

function directionStartXml(d: Direction, wedgeNumbers: Map<string, number>): string {
  const placement = d.placement;
  switch (d.kind) {
    case 'dynamic':
      return directionXml([el('dynamics', {}, dynamicChildren(d.value))], d.staff, placement ?? 'below');
    case 'wedge': {
      const used = new Set(wedgeNumbers.values());
      let num = 1;
      while (used.has(num)) num++;
      wedgeNumbers.set(d.id, num);
      return directionXml([el('wedge', { type: d.value, number: num })], d.staff, placement ?? 'below');
    }
    case 'text':
      return directionXml([el('words', {}, d.value)], d.staff, placement);
    case 'tempo':
      return tempoXml({ bpm: d.tempo!.bpm, beatUnit: d.tempo!.beatUnit, text: d.value || undefined }, d.staff);
    case 'octave-shift':
      return directionXml(
        [el('octave-shift', { type: d.octaveShift!.type, size: d.octaveShift!.size, number: 1 })],
        d.staff,
        placement,
      );
    default:
      return (d.raw ?? []).map(serializeNode).join('');
  }
}

function directionEndXml(d: Direction, wedgeNumbers: Map<string, number>): string {
  if (d.kind === 'wedge') {
    const num = wedgeNumbers.get(d.id) ?? 1;
    wedgeNumbers.delete(d.id);
    return directionXml([el('wedge', { type: 'stop', number: num })], d.staff, d.placement ?? 'below');
  }
  if (d.kind === 'octave-shift') {
    return directionXml(
      [el('octave-shift', { type: 'stop', size: d.octaveShift!.size, number: 1 })],
      d.staff,
      d.placement,
    );
  }
  return '';
}

const STANDARD_DYNAMICS = new Set(
  'p pp ppp pppp ppppp pppppp f ff fff ffff fffff ffffff mp mf sf sfp sfpp fp rf rfz sfz sffz fz n pf sfzp'.split(' '),
);

function dynamicChildren(value: string): string[] {
  return STANDARD_DYNAMICS.has(value) ? [el(value)] : [el('other-dynamics', {}, value)];
}

/** 小節内で必要な臨時記号を決める（調号と、同じ小節で前に出た臨時記号を考える） */
function accidentalPlanner(notes: Note[], writtenFifths: number, t: Transposition | null): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const keyAlt = keyAlterations(writtenFifths);
  const byStaff = groupBy(notes, (n) => String(n.staff));
  for (const staffNotes of byStaff.values()) {
    const sorted = staffNotes.slice().sort((a, b) => cmp(a.onset, b.onset) || Number(!a.grace) - Number(!b.grace));
    const state = new Map<string, number>(); // 'C4' → 有効な変化
    for (const n of sorted) {
      for (const h of n.heads) {
        if (h.unpitched) continue;
        const w = writtenPitch(h.pitch, t);
        const slot = `${w.step}${w.octave}`;
        const current = state.get(slot) ?? keyAlt[w.step];
        let need = w.alter !== current;
        // 前の小節からタイでつながった音には付けない
        if (h.tie?.stop && !state.has(slot) && isZero(n.onset)) need = false;
        state.set(slot, w.alter);
        if (h.accidentalShown === 'courtesy' || h.accidentalShown === 'paren') need = true;
        result.set(h.id, need ? ACCIDENTAL_NAMES[w.alter] : null);
      }
    }
  }
  return result;
}

function noteXml(
  n: Note,
  t: Transposition | null,
  dur: (f: Fraction) => number,
  accidentals: Map<string, string | null>,
  slurNumbers: Map<string, number>,
  usedSlurNumbers: Set<number>,
): string {
  const ratio = tupletRatio(n);
  const notation = n.notation ?? notationFor(n.duration, ratio) ?? { type: 'quarter' as const, dots: 0 };
  const heads: (NoteHead | null)[] = n.heads.length ? n.heads : [null];
  return heads
    .map((h, hi) => {
      const c: string[] = [];
      if (n.grace) c.push(el('grace', n.grace.slash ? { slash: 'yes' } : {}));
      if (hi > 0) c.push(el('chord'));
      if (!h) c.push(el('rest', n.measureRest ? { measure: 'yes' } : {}));
      else if (h.unpitched)
        c.push(el('unpitched', {}, [el('display-step', {}, h.pitch.step), el('display-octave', {}, h.pitch.octave)]));
      else {
        const w = writtenPitch(h.pitch, t);
        const p = [el('step', {}, w.step)];
        if (w.alter) p.push(el('alter', {}, w.alter));
        p.push(el('octave', {}, w.octave));
        c.push(el('pitch', {}, p));
      }
      if (!n.grace) c.push(el('duration', {}, dur(n.duration)));
      if (h?.tie?.stop) c.push(el('tie', { type: 'stop' }));
      if (h?.tie?.start) c.push(el('tie', { type: 'start' }));
      c.push(el('voice', {}, n.voice));
      if (!n.measureRest || n.notation) c.push(el('type', {}, notation.type));
      for (let i = 0; i < notation.dots; i++) c.push(el('dot'));
      const acc = h ? accidentals.get(h.id) : null;
      if (acc && h) {
        const a: Record<string, string> = {};
        if (h.accidentalShown === 'courtesy') a.cautionary = 'yes';
        if (h.accidentalShown === 'paren') a.parentheses = 'yes';
        c.push(el('accidental', a, acc));
      }
      if (n.tuplets?.length) {
        const product = n.tuplets.reduce((r, x) => ({ a: r.a * x.actual, n: r.n * x.normal }), { a: 1, n: 1 });
        const tm = [el('actual-notes', {}, product.a), el('normal-notes', {}, product.n)];
        const inner = n.tuplets[n.tuplets.length - 1];
        if (inner.normalType) tm.push(el('normal-type', {}, inner.normalType));
        c.push(el('time-modification', {}, tm));
      }
      for (const p of n.passthrough?.note ?? [])
        if (p.tag === 'notehead' || p.tag === 'notehead-text') c.push(serializeNode(p));
      if (n.staff !== 1) c.push(el('staff', {}, n.staff));
      if (hi === 0) (n.beams ?? []).forEach((b, i) => c.push(el('beam', { number: i + 1 }, b)));

      const notations: string[] = [];
      if (h?.tie?.stop) notations.push(el('tied', { type: 'stop' }));
      if (h?.tie?.start) notations.push(el('tied', { type: 'start' }));
      if (hi === 0) {
        for (const s of n.slurs ?? []) {
          if (s.type === 'start') {
            const reserved = slurNumbers.get(s.id);
            if (reserved !== undefined) {
              // 終わりを先に書いたスラー：同じ番号で始まりを書いて番号を空ける
              usedSlurNumbers.delete(reserved);
              slurNumbers.delete(s.id);
              notations.push(el('slur', { type: 'start', number: reserved }));
              continue;
            }
            let num = 1;
            while (usedSlurNumbers.has(num)) num++;
            usedSlurNumbers.add(num);
            slurNumbers.set(s.id, num);
            notations.push(el('slur', { type: 'start', number: num }));
          } else {
            const num = slurNumbers.get(s.id);
            if (num === undefined) {
              // 終わりが先に書かれている（2声部目など）：番号だけ予約する
              let k = 1;
              while (usedSlurNumbers.has(k)) k++;
              usedSlurNumbers.add(k);
              slurNumbers.set(s.id, k);
              notations.push(el('slur', { type: 'stop', number: k }));
            } else {
              usedSlurNumbers.delete(num);
              slurNumbers.delete(s.id);
              notations.push(el('slur', { type: 'stop', number: num }));
            }
          }
        }
        (n.tuplets ?? []).forEach((tp, level) => {
          const a: Record<string, string | number> = { number: level + 1 };
          if (tp.bracket !== undefined) a.bracket = tp.bracket ? 'yes' : 'no';
          if (tp.showNumber) a['show-number'] = tp.showNumber;
          if (tp.start) notations.push(el('tuplet', { type: 'start', ...a }));
          if (tp.stop) notations.push(el('tuplet', { type: 'stop', ...a }));
        });
        const arts = n.articulations.filter((a) => !a.startsWith('fermata'));
        if (arts.length)
          notations.push(
            el(
              'articulations',
              {},
              arts.map((a) => el(a)),
            ),
          );
        for (const f of n.articulations.filter((a) => a.startsWith('fermata'))) {
          notations.push(el('fermata', f === 'fermata-inverted' ? { type: 'inverted' } : {}));
        }
        if (n.tremolo) notations.push(el('ornaments', {}, [el('tremolo', { type: n.tremolo.type }, n.tremolo.marks)]));
        for (const p of n.passthrough?.notations ?? []) notations.push(serializeNode(p));
      }
      if (notations.length) c.push(el('notations', {}, notations));
      if (hi === 0)
        for (const p of n.passthrough?.note ?? [])
          if (p.tag !== 'notehead' && p.tag !== 'notehead-text') c.push(serializeNode(p));
      return el('note', {}, c);
    })
    .join('');
}
