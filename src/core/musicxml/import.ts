// MusicXML（score-partwise）→ 内部データ。移調楽器の音は <transpose> を使って実音に直す。

import { guessInstrument, transpositionOverride } from '../instruments';
import { isNoteType } from '../model/notation';
import {
  SCHEMA_VERSION,
  type BeamValue,
  type ClefChange,
  type ClefSign,
  type Direction,
  type Jump,
  type MeasureMeta,
  type Note,
  type NoteHead,
  type Part,
  type Score,
  type Transposition,
  type Tuplet,
  type XmlNode,
} from '../model/types';
import { add, cmp, eq, frac, fromDivisions, lt, sub, ZERO, type Fraction } from '../theory/fraction';
import { AlterOverflowError, transposePitch } from '../theory/interval';
import { normalizeKey, transposeKey, type Mode } from '../theory/key';
import { isAlter, pitch, spellFromDiatonic, diatonicIndex, midi, type Pitch, type Step } from '../theory/pitch';
import { ImportError, type IgnoredElement, type ImportWarning } from './errors';
import { child, childNumber, childrenOf, childText, elements, parseXml, text, XmlParseError } from './xml';
import { notatedValue, NOTE_TYPE_VALUES } from '../model/notation';

export type ImportResult = {
  score: Score;
  warnings: ImportWarning[];
  ignored: IgnoredElement[];
  software?: string;
};

// 仕様で「無視」と決めている要素（一覧には出すが、問題ではない）
const EXPECTED_IGNORED = new Set([
  'print',
  'defaults',
  'credit',
  'midi-instrument',
  'midi-device',
  'stem',
  'part-name-display',
  'part-abbreviation-display',
  'measure-style',
  'instrument',
  'listening',
  'grouping',
  'bookmark',
  'link',
  'footnote',
  'level',
  'virtual-instrument',
  'player',
  'staff-details',
  'part-symbol',
  'cancel',
  'supports',
  'encoding-date',
  'encoder',
  'rights',
  'source',
  'miscellaneous',
  'relation',
  'system-layout',
  'page-layout',
  'staff-layout',
]);

const NOTE_PASSTHROUGH = new Set(['lyric', 'notehead', 'notehead-text', 'play', 'listen']);
const NOTATIONS_PASSTHROUGH = new Set([
  'technical',
  'ornaments',
  'arpeggiate',
  'non-arpeggiate',
  'glissando',
  'slide',
  'accidental-mark',
  'other-notation',
  'dynamics',
]);

class Ctx {
  warnings: ImportWarning[] = [];
  ignored = new Map<string, number>();
  seq = 0;
  id(prefix: string) {
    return `${prefix}${(this.seq++).toString(36)}`;
  }
  warn(w: ImportWarning) {
    // 同じ種類の警告が大量に出ないように、種類ごとに50件まで
    if (this.warnings.filter((x) => x.code === w.code).length < 50) this.warnings.push(w);
  }
  ignore(name: string) {
    this.ignored.set(name, (this.ignored.get(name) ?? 0) + 1);
  }
}

export function importMusicXml(xml: string): ImportResult {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (e) {
    if (e instanceof XmlParseError)
      throw new ImportError('broken', `XMLとして読めません（ファイルが壊れている可能性があります）：${e.message}`);
    throw e;
  }
  if (root.tag === 'score-timewise') {
    throw new ImportError(
      'timewise',
      'score-timewise 形式のMusicXMLには対応していません。楽譜ソフトで score-partwise 形式（通常の形式）で書き出してください。',
    );
  }
  if (root.tag !== 'score-partwise') {
    throw new ImportError('unsupported-format', `MusicXMLではありません（ルート要素が <${root.tag}>）。`);
  }
  const ctx = new Ctx();

  // ---- 曲の情報 ----
  const title = childText(child(root, 'work'), 'work-title') ?? '';
  const movementTitle = childText(root, 'movement-title');
  const identification = child(root, 'identification');
  const composer =
    childrenOf(identification, 'creator')
      .filter((c) => c.attrs.type === 'composer')
      .map((c) => text(c).trim())
      .join(', ') || '';
  const software = childText(child(identification, 'encoding'), 'software');
  for (const e of elements(root)) {
    if (!['work', 'movement-title', 'movement-number', 'identification', 'part-list', 'part'].includes(e.tag))
      ctx.ignore(e.tag);
  }

  // ---- パート一覧 ----
  const partList = child(root, 'part-list');
  const partGroups: XmlNode[] = [];
  const partInfos: {
    id: string;
    name: string;
    abbr?: string;
    instrumentName?: string;
    sound?: string;
    midiProgram?: number;
  }[] = [];
  for (const e of elements(partList)) {
    if (e.tag === 'part-group') {
      partGroups.push({ ...e, attrs: { ...e.attrs, 'data-before-part': String(partInfos.length) } });
    } else if (e.tag === 'score-part') {
      const si = child(e, 'score-instrument');
      const mi = child(e, 'midi-instrument');
      const program = childNumber(mi, 'midi-program');
      partInfos.push({
        id: e.attrs.id,
        name: childText(e, 'part-name') ?? '',
        abbr: childText(e, 'part-abbreviation') || undefined,
        instrumentName: childText(si, 'instrument-name'),
        sound: childText(si, 'instrument-sound'),
        midiProgram: program !== undefined ? program - 1 : undefined,
      });
    }
  }
  const partEls = childrenOf(root, 'part');
  if (partEls.length === 0) throw new ImportError('empty', 'パートがひとつもありません。');

  const measures: MeasureMeta[] = [];
  const notes: Note[] = [];
  const directions: Direction[] = [];
  const clefs: ClefChange[] = [];
  const parts: Part[] = [];
  const measureCounts: number[] = [];

  partEls.forEach((partEl, partIndex) => {
    const info = partInfos.find((p) => p.id === partEl.attrs.id) ?? {
      id: partEl.attrs.id ?? `P${partIndex + 1}`,
      name: '',
    };
    const result = importPart(ctx, partEl, info.id, partIndex, measures, notes, directions, clefs);
    measureCounts.push(result.measureCount);
    const def = guessInstrument({
      partName: info.name,
      instrumentName: info.instrumentName,
      sound: info.sound,
      transposition: result.transposition,
    });
    const part: Part = {
      id: info.id,
      name: info.name,
      instrumentId: def.id,
      staves: result.staves,
      source: { instrumentName: info.instrumentName, instrumentSound: info.sound, midiProgram: info.midiProgram },
    };
    if (info.abbr) part.abbr = info.abbr;
    const override = transpositionOverride(def.id, result.transposition);
    if (override !== undefined) part.transposition = override;
    parts.push(part);
  });

  if (new Set(measureCounts).size > 1) {
    ctx.warn({
      code: 'measure-count',
      message: `パートによって小節数が違います（${measureCounts.join('・')}）。少ないパートは休みとして扱います。`,
    });
  }
  if (!measures[0]?.time) {
    measures[0] ??= { index: 0, displayNumber: '1' };
    measures[0].time = { beats: 4, beatType: 4 };
  }
  if (!measures[0].key) measures[0].key = { fifths: 0, mode: 'major' };

  checkMeasureLengths(ctx, measures, notes);

  const score: Score = {
    schemaVersion: SCHEMA_VERSION,
    id: ctx.id('score-'),
    title,
    composer,
    parts,
    measures,
    notes,
    directions,
    clefs,
  };
  if (movementTitle) score.movementTitle = movementTitle;
  if (partGroups.length) score.passthrough = { partGroups };

  return {
    score,
    warnings: ctx.warnings,
    ignored: [...ctx.ignored.entries()]
      .map(([name, count]) => ({ name, count, expected: EXPECTED_IGNORED.has(name) }))
      .sort((a, b) => Number(a.expected) - Number(b.expected) || b.count - a.count),
    software,
  };
}

// ---------------------------------------------------------------------------

type OpenSpan = { dir: Direction };

function importPart(
  ctx: Ctx,
  partEl: XmlNode,
  partId: string,
  partIndex: number,
  measures: MeasureMeta[],
  notes: Note[],
  directions: Direction[],
  clefs: ClefChange[],
): { measureCount: number; transposition: Transposition | null; staves: number } {
  let divisions = 1;
  let transposition: Transposition | null = null;
  let firstTransposition: Transposition | null | undefined;
  let staves = 1;
  let concertKey: { fifths: number; mode: Mode } | undefined;
  let time: { beats: number; beatType: number } = { beats: 4, beatType: 4 };
  const tupletStacks = new Map<string, Tuplet[]>();
  const openSlurs = new Map<string, string>();
  const pendingSlurStops = new Map<string, { measure: number; onset: Fraction; slur: { id: string; type: 'stop' } }>();
  const openWedges = new Map<string, OpenSpan>();
  const pendingWedgeStops = new Map<string, { measure: number; onset: Fraction }>();
  const openShifts = new Map<string, OpenSpan>();

  const measureEls = childrenOf(partEl, 'measure');
  measureEls.forEach((mEl, mi) => {
    const meta = (measures[mi] ??= { index: mi, displayNumber: mEl.attrs.number ?? String(mi + 1) });
    if (partIndex === 0) {
      meta.displayNumber = mEl.attrs.number ?? String(mi + 1);
      if (mEl.attrs.implicit === 'yes') meta.implicit = true;
    }
    let cursor: Fraction = ZERO;
    let lastNote: Note | undefined;
    const measureNotes: Note[] = [];

    const toFrac = (d: number) => fromDivisions(d, divisions);

    for (const e of elements(mEl)) {
      switch (e.tag) {
        case 'attributes': {
          // <transpose> は <key> より後に書かれるので、先に読んでおく（調号を実音に直すため）
          const ordered = [...childrenOf(e, 'transpose'), ...elements(e).filter((a) => a.tag !== 'transpose')];
          for (const a of ordered) {
            switch (a.tag) {
              case 'divisions':
                divisions = Number(text(a)) || 1;
                break;
              case 'key': {
                const fifths = childNumber(a, 'fifths');
                if (fifths === undefined) {
                  ctx.ignore('key（fifths以外の調号）');
                  break;
                }
                const mode: Mode = childText(a, 'mode') === 'minor' ? 'minor' : 'major';
                let concert = { fifths, mode };
                if (transposition) concert = normalizeKey(transposeKey(concert, transposition));
                const unpitched = staves === 1 && clefs.some((c) => c.partId === partId && c.sign === 'percussion');
                if (unpitched) break;
                if (!concertKey || concertKey.fifths !== concert.fifths || concertKey.mode !== concert.mode) {
                  concertKey = concert;
                  if (partIndex === 0) {
                    meta.key = concert;
                  } else if (meta.key?.fifths !== concert.fifths) {
                    ctx.warn({
                      code: 'key-mismatch',
                      message: `${meta.displayNumber}小節目：パートによって（実音の）調号が違います。最初のパートの調号を使います。`,
                      partId,
                      measure: mi,
                    });
                  }
                }
                break;
              }
              case 'time': {
                if (child(a, 'senza-misura')) {
                  ctx.ignore('senza-misura');
                  break;
                }
                const beatsText = childText(a, 'beats') ?? '4';
                let beats = Number(beatsText);
                if (!Number.isFinite(beats)) {
                  beats = beatsText.split('+').reduce((s, x) => s + Number(x), 0);
                  ctx.warn({
                    code: 'compound-time',
                    message: `${meta.displayNumber}小節目：拍子 ${beatsText} は合計（${beats}）として扱います。`,
                    measure: mi,
                  });
                }
                const beatType = childNumber(a, 'beat-type') ?? 4;
                const symbol = a.attrs.symbol === 'common' || a.attrs.symbol === 'cut' ? a.attrs.symbol : undefined;
                if (time.beats !== beats || time.beatType !== beatType || mi === 0 || symbol) {
                  time = { beats, beatType };
                  if (partIndex === 0) meta.time = symbol ? { beats, beatType, symbol } : { beats, beatType };
                  else if (meta.time?.beats !== beats || meta.time?.beatType !== beatType) {
                    ctx.warn({
                      code: 'time-mismatch',
                      message: `${meta.displayNumber}小節目：パートによって拍子が違います。最初のパートの拍子を使います。`,
                      partId,
                      measure: mi,
                    });
                  }
                }
                break;
              }
              case 'staves':
                staves = Number(text(a)) || 1;
                break;
              case 'clef': {
                const staff = Number(a.attrs.number ?? 1);
                const sign = (childText(a, 'sign') ?? 'G') as ClefSign;
                const line = childNumber(a, 'line') ?? (sign === 'F' ? 4 : sign === 'C' ? 3 : 2);
                const oct = childNumber(a, 'clef-octave-change');
                const c: ClefChange = { partId, staff, measure: mi, onset: cursor, sign, line };
                if (oct) c.octaveChange = oct;
                clefs.push(c);
                break;
              }
              case 'transpose': {
                if (a.attrs.number && a.attrs.number !== '1') break;
                const oct = childNumber(a, 'octave-change') ?? 0;
                const t: Transposition = {
                  diatonic: (childNumber(a, 'diatonic') ?? 0) + 7 * oct,
                  chromatic: (childNumber(a, 'chromatic') ?? 0) + 12 * oct,
                };
                if (child(a, 'double')) {
                  t.diatonic -= 7;
                  t.chromatic -= 12;
                }
                const isZero = t.diatonic === 0 && t.chromatic === 0;
                transposition = isZero ? null : t;
                if (firstTransposition === undefined) firstTransposition = transposition;
                else if (JSON.stringify(firstTransposition) !== JSON.stringify(transposition)) {
                  ctx.warn({
                    code: 'transpose-change',
                    message: `${meta.displayNumber}小節目：曲の途中で楽器の移調が変わっています（持ち替え）。音は実音に直して読み込みます。`,
                    partId,
                    measure: mi,
                  });
                }
                break;
              }
              default:
                ctx.ignore(a.tag);
            }
          }
          break;
        }
        case 'note': {
          const n = readNote(ctx, e, {
            partId,
            mi,
            cursor,
            divisions,
            transposition,
            tupletStacks,
            openSlurs,
            pendingSlurStops,
            time,
          });
          if (n.chord) {
            if (!lastNote) {
              ctx.warn({
                code: 'chord-without-note',
                message: `${meta.displayNumber}小節目：和音の土台になる音がありません。`,
                partId,
                measure: mi,
              });
              break;
            }
            lastNote.heads.push(...n.note.heads);
            for (const a of n.note.articulations)
              if (!lastNote.articulations.includes(a)) lastNote.articulations.push(a);
            if (n.note.slurs) (lastNote.slurs ??= []).push(...n.note.slurs);
            if (n.note.passthrough) {
              lastNote.passthrough ??= {};
              if (n.note.passthrough.note) (lastNote.passthrough.note ??= []).push(...n.note.passthrough.note);
              if (n.note.passthrough.notations)
                (lastNote.passthrough.notations ??= []).push(...n.note.passthrough.notations);
            }
            break;
          }
          lastNote = n.note;
          notes.push(n.note);
          measureNotes.push(n.note);
          if (!n.note.grace) cursor = add(cursor, n.note.duration);
          break;
        }
        case 'backup':
          cursor = sub(cursor, toFrac(childNumber(e, 'duration') ?? 0));
          if (lt(cursor, ZERO)) cursor = ZERO;
          break;
        case 'forward':
          cursor = add(cursor, toFrac(childNumber(e, 'duration') ?? 0));
          break;
        case 'direction':
          readDirection(ctx, e, {
            partId,
            partIndex,
            mi,
            meta,
            cursor,
            divisions,
            directions,
            openWedges,
            pendingWedgeStops,
            openShifts,
          });
          break;
        case 'sound':
          readSound(e, meta, partIndex, cursor);
          break;
        case 'barline':
          if (partIndex === 0) readBarline(ctx, e, meta);
          break;
        case 'harmony':
        case 'figured-bass':
          directions.push({
            id: ctx.id('d'),
            partId,
            measure: mi,
            onset: cursor,
            staff: Number(childText(e, 'staff') ?? 1),
            kind: 'other',
            value: e.tag,
            raw: [e],
          });
          break;
        default:
          ctx.ignore(e.tag);
      }
    }
    // 全休符の長さが 0 や書かれていない場合は、拍子から求める
    for (const n of measureNotes) {
      if (n.measureRest && n.duration.num === 0) n.duration = frac(time.beats, time.beatType);
    }
  });

  for (const [num] of openSlurs) {
    ctx.warn({ code: 'unmatched-slur', message: `スラー（番号${num}）の終わりが見つかりません。`, partId });
  }
  for (const [, stop] of pendingSlurStops) {
    ctx.warn({
      code: 'unmatched-slur',
      message: `${stop.measure + 1}小節目：始まりのないスラーの終わりがあります。`,
      partId,
      measure: stop.measure,
    });
  }
  for (const [, stop] of pendingWedgeStops) {
    ctx.warn({
      code: 'unmatched-wedge',
      message: `${stop.measure + 1}小節目：始まりのないクレッシェンド等の終わりがあります。`,
      partId,
      measure: stop.measure,
    });
  }
  for (const [, span] of openWedges) {
    ctx.warn({
      code: 'unmatched-wedge',
      message: `${span.dir.measure + 1}小節目のクレッシェンド等の終わりが見つかりません。`,
      partId,
      measure: span.dir.measure,
    });
  }
  return { measureCount: measureEls.length, transposition: firstTransposition ?? null, staves };
}

// ---------------------------------------------------------------------------

function toConcert(ctx: Ctx, written: Pitch, t: Transposition | null, where: { partId: string; mi: number }): Pitch {
  if (!t) return written;
  try {
    return transposePitch(written, t);
  } catch (e) {
    if (!(e instanceof AlterOverflowError)) throw e;
    ctx.warn({
      code: 'alter-overflow',
      message: `${where.mi + 1}小節目：実音に直すと変化記号が多すぎるため、異名同音で書き換えました。`,
      partId: where.partId,
      measure: where.mi,
    });
    const m = midi(written) + t.chromatic;
    const d = diatonicIndex(written) + t.diatonic;
    return spellFromDiatonic(d - 1, m) ?? spellFromDiatonic(d + 1, m) ?? spellFromDiatonic(d, m)!;
  }
}

function readPitchEl(
  ctx: Ctx,
  el: XmlNode,
  stepTag: string,
  octaveTag: string,
  where: { partId: string; mi: number },
): Pitch {
  const step = (childText(el, stepTag) ?? 'C') as Step;
  let alter = childNumber(el, 'alter') ?? 0;
  if (!isAlter(alter)) {
    ctx.warn({
      code: 'microtone',
      message: `${where.mi + 1}小節目：微分音（alter=${alter}）は近い半音に丸めました。`,
      partId: where.partId,
      measure: where.mi,
    });
    alter = Math.max(-2, Math.min(2, Math.round(alter)));
  }
  return pitch(step, alter, childNumber(el, octaveTag) ?? 4);
}

function readNote(
  ctx: Ctx,
  e: XmlNode,
  s: {
    partId: string;
    mi: number;
    cursor: Fraction;
    divisions: number;
    transposition: Transposition | null;
    tupletStacks: Map<string, Tuplet[]>;
    openSlurs: Map<string, string>;
    pendingSlurStops: Map<string, { measure: number; onset: Fraction; slur: { id: string; type: 'stop' } }>;
    time: { beats: number; beatType: number };
  },
): { note: Note; chord: boolean } {
  const chord = !!child(e, 'chord');
  const graceEl = child(e, 'grace');
  const staff = childNumber(e, 'staff') ?? 1;
  const voice = Number(childText(e, 'voice') ?? 1) || 1;
  const typeText = childText(e, 'type');
  const dots = childrenOf(e, 'dot').length;
  const where = { partId: s.partId, mi: s.mi };

  // 音の長さ
  let duration: Fraction;
  if (graceEl) {
    duration = typeText && isNoteType(typeText) ? notatedValue(typeText, dots) : NOTE_TYPE_VALUES.eighth;
  } else {
    duration = fromDivisions(childNumber(e, 'duration') ?? 0, s.divisions);
  }

  // 音高
  const heads: NoteHead[] = [];
  const restEl = child(e, 'rest');
  const ties = [...childrenOf(e, 'tie'), ...childrenOf(child(e, 'notations'), 'tied')].map((t) => t.attrs.type);
  if (!restEl) {
    const pitchEl = child(e, 'pitch');
    const unpitchedEl = child(e, 'unpitched');
    let p: Pitch;
    if (pitchEl) p = toConcert(ctx, readPitchEl(ctx, pitchEl, 'step', 'octave', where), s.transposition, where);
    else if (unpitchedEl) p = readPitchEl(ctx, unpitchedEl, 'display-step', 'display-octave', where);
    else p = pitch('C', 0, 4);
    const head: NoteHead = { id: ctx.id('h'), pitch: p };
    if (unpitchedEl) head.unpitched = true;
    if (ties.includes('start') || ties.includes('stop')) {
      head.tie = {};
      if (ties.includes('start')) head.tie.start = true;
      if (ties.includes('stop')) head.tie.stop = true;
    }
    const acc = child(e, 'accidental');
    if (acc?.attrs.parentheses === 'yes' || acc?.attrs.bracket === 'yes') head.accidentalShown = 'paren';
    else if (acc?.attrs.cautionary === 'yes' || acc?.attrs.editorial === 'yes') head.accidentalShown = 'courtesy';
    heads.push(head);
  }

  const note: Note = {
    id: ctx.id('n'),
    partId: s.partId,
    measure: s.mi,
    staff,
    voice,
    onset: s.cursor,
    duration,
    heads,
    articulations: [],
    origin: 'source',
  };
  if (typeText && isNoteType(typeText)) note.notation = { type: typeText, dots };
  if (restEl?.attrs.measure === 'yes') note.measureRest = true;
  if (graceEl) note.grace = { slash: graceEl.attrs.slash === 'yes' };

  // 連桁
  const beams = childrenOf(e, 'beam')
    .sort((a, b) => Number(a.attrs.number ?? 1) - Number(b.attrs.number ?? 1))
    .map((b) => text(b).trim() as BeamValue);
  if (beams.length) note.beams = beams;

  // note 直下で保持だけする要素・無視する要素
  for (const c of elements(e)) {
    if (NOTE_PASSTHROUGH.has(c.tag)) ((note.passthrough ??= {}).note ??= []).push(c);
    else if (
      ![
        'chord',
        'grace',
        'cue',
        'pitch',
        'unpitched',
        'rest',
        'duration',
        'tie',
        'voice',
        'type',
        'dot',
        'accidental',
        'time-modification',
        'staff',
        'beam',
        'notations',
      ].includes(c.tag)
    )
      ctx.ignore(c.tag);
    if (c.tag === 'cue') ctx.ignore('cue（小さい音符として表示されません）');
  }

  // notations
  const tupletEls: XmlNode[] = [];
  for (const notations of childrenOf(e, 'notations')) {
    for (const c of elements(notations)) {
      switch (c.tag) {
        case 'tied':
          break;
        case 'slur': {
          const num = c.attrs.number ?? '1';
          if (c.attrs.type === 'start') {
            const id = ctx.id('s');
            (note.slurs ??= []).push({ id, type: 'start' });
            // 2声部目などでは、終わりが始まりより先に書かれていることがある
            const pending = s.pendingSlurStops.get(num);
            if (pending && pending.measure === s.mi && !lt(pending.onset, s.cursor)) {
              pending.slur.id = id;
              s.pendingSlurStops.delete(num);
            } else {
              s.openSlurs.set(num, id);
            }
          } else if (c.attrs.type === 'stop') {
            const id = s.openSlurs.get(num);
            if (id) {
              s.openSlurs.delete(num);
              (note.slurs ??= []).push({ id, type: 'stop' });
            } else {
              const slur = { id: ctx.id('s'), type: 'stop' as const };
              (note.slurs ??= []).push(slur);
              s.pendingSlurStops.set(num, { measure: s.mi, onset: s.cursor, slur });
            }
          }
          break;
        }
        case 'tuplet':
          tupletEls.push(c);
          break;
        case 'articulations':
          for (const a of elements(c)) note.articulations.push(a.tag);
          break;
        case 'fermata':
          note.articulations.push(c.attrs.type === 'inverted' ? 'fermata-inverted' : 'fermata');
          break;
        case 'ornaments': {
          const tremolo = child(c, 'tremolo');
          if (tremolo) {
            const type = (tremolo.attrs.type ?? 'single') as 'single' | 'start' | 'stop';
            note.tremolo = {
              type: type === 'start' || type === 'stop' ? type : 'single',
              marks: Number(text(tremolo)) || 3,
            };
          }
          const rest = elements(c).filter((x) => x.tag !== 'tremolo');
          if (rest.length) ((note.passthrough ??= {}).notations ??= []).push({ ...c, children: rest });
          break;
        }
        default:
          if (NOTATIONS_PASSTHROUGH.has(c.tag)) ((note.passthrough ??= {}).notations ??= []).push(c);
          else ctx.ignore(c.tag);
      }
    }
  }

  // 連符（和音の2音目以降は土台の音に従う）
  if (!chord) {
    const key = `${staff}/${voice}`;
    const stack = s.tupletStacks.get(key) ?? [];
    const tm = child(e, 'time-modification');
    const tmActual = childNumber(tm, 'actual-notes');
    const tmNormal = childNumber(tm, 'normal-notes');
    const tmType = childText(tm, 'normal-type');
    const started = new Set<string>();
    for (const t of tupletEls.filter((t) => t.attrs.type === 'start')) {
      const outer = stack.reduce((r, x) => ({ a: r.a * x.actual, n: r.n * x.normal }), { a: 1, n: 1 });
      const ta = childNumber(child(t, 'tuplet-actual'), 'tuplet-number');
      const tn = childNumber(child(t, 'tuplet-normal'), 'tuplet-number');
      let actual = ta ?? (tmActual ? tmActual / outer.a : 3);
      let normal = tn ?? (tmNormal ? tmNormal / outer.n : 2);
      if (!Number.isInteger(actual) || !Number.isInteger(normal)) {
        actual = tmActual ?? 3;
        normal = tmNormal ?? 2;
      }
      const tuplet: Tuplet = { id: ctx.id('t'), actual, normal };
      const nt = childText(child(t, 'tuplet-normal'), 'tuplet-type') ?? (stack.length === 0 ? tmType : undefined);
      if (nt && isNoteType(nt)) tuplet.normalType = nt;
      if (t.attrs.bracket) tuplet.bracket = t.attrs.bracket === 'yes';
      if (t.attrs['show-number'] === 'none' || t.attrs['show-number'] === 'both')
        tuplet.showNumber = t.attrs['show-number'];
      stack.push(tuplet);
      started.add(tuplet.id);
    }
    const stops = tupletEls.filter((t) => t.attrs.type === 'stop').length;
    if (stack.length) {
      note.tuplets = stack.map((t, i) => {
        const copy: Tuplet = { ...t };
        if (started.has(t.id)) copy.start = true;
        if (i >= stack.length - stops) copy.stop = true;
        return copy;
      });
      for (let i = 0; i < stops && stack.length; i++) stack.pop();
    } else if (tmActual && tmNormal && (tmActual !== 1 || tmNormal !== 1)) {
      // 括弧の指定がない連符（time-modification だけ）
      const tuplet: Tuplet = { id: ctx.id('t'), actual: tmActual, normal: tmNormal };
      if (tmType && isNoteType(tmType)) tuplet.normalType = tmType;
      note.tuplets = [tuplet];
    }
    s.tupletStacks.set(key, stack);
  }

  return { note, chord };
}

// ---------------------------------------------------------------------------

const JUMP_ATTRS: [string, Jump][] = [
  ['dacapo', 'dacapo'],
  ['dalsegno', 'dalsegno'],
  ['fine', 'fine'],
  ['tocoda', 'tocoda'],
];

function addJump(meta: MeasureMeta, j: Jump) {
  meta.jumps ??= [];
  if (!meta.jumps.includes(j)) meta.jumps.push(j);
}

function readSound(e: XmlNode, meta: MeasureMeta, partIndex: number, onset: Fraction) {
  if (partIndex !== 0) return;
  for (const [attr, j] of JUMP_ATTRS) if (e.attrs[attr]) addJump(meta, j);
  if (e.attrs.tempo && eq(onset, ZERO) && !meta.tempo) {
    meta.tempo = { bpm: Number(e.attrs.tempo), beatUnit: frac(1, 4) };
  }
}

function readDirection(
  ctx: Ctx,
  e: XmlNode,
  s: {
    partId: string;
    partIndex: number;
    mi: number;
    meta: MeasureMeta;
    cursor: Fraction;
    divisions: number;
    directions: Direction[];
    openWedges: Map<string, OpenSpan>;
    pendingWedgeStops: Map<string, { measure: number; onset: Fraction }>;
    openShifts: Map<string, OpenSpan>;
  },
) {
  const offset = childNumber(e, 'offset');
  const onset = offset ? add(s.cursor, fromDivisions(offset, s.divisions)) : s.cursor;
  const staff = childNumber(e, 'staff') ?? 1;
  const placement: 'above' | 'below' | undefined =
    e.attrs.placement === 'above' || e.attrs.placement === 'below' ? e.attrs.placement : undefined;
  const sound = child(e, 'sound');
  const base = { partId: s.partId, measure: s.mi, onset, staff, ...(placement ? { placement } : {}) };
  const make = (d: Omit<Direction, 'id' | keyof typeof base>): Direction => ({ id: ctx.id('d'), ...base, ...d });

  // 解釈できない要素（dashes・bracket・pedal など）を含む direction は、丸ごとそのまま持つ
  const KNOWN = new Set(['dynamics', 'wedge', 'words', 'metronome', 'rehearsal', 'segno', 'coda', 'octave-shift']);
  const unknown = childrenOf(e, 'direction-type')
    .flatMap((dt) => elements(dt))
    .filter((c) => !KNOWN.has(c.tag));
  if (unknown.length) {
    s.directions.push(make({ kind: 'other', value: unknown.map((o) => o.tag).join(','), raw: [e] }));
    if (sound && s.partIndex === 0) for (const [attr, j] of JUMP_ATTRS) if (sound.attrs[attr]) addJump(s.meta, j);
    return;
  }

  const words: string[] = [];
  let metronome: { bpm: number; beatUnit: Fraction } | undefined;

  for (const dt of childrenOf(e, 'direction-type')) {
    for (const c of elements(dt)) {
      switch (c.tag) {
        case 'dynamics': {
          const v = elements(c)
            .map((x) => (x.tag === 'other-dynamics' ? text(x) : x.tag))
            .join('');
          s.directions.push(make({ kind: 'dynamic', value: v }));
          break;
        }
        case 'wedge': {
          const num = c.attrs.number ?? '1';
          const type = c.attrs.type;
          if (type === 'crescendo' || type === 'diminuendo') {
            const dir = make({ kind: 'wedge', value: type });
            s.directions.push(dir);
            // 2声部目などでは、終わりが始まりより先に書かれていることがある
            const pending = s.pendingWedgeStops.get(num);
            if (pending && pending.measure === s.mi && !lt(pending.onset, onset)) {
              dir.end = pending;
              s.pendingWedgeStops.delete(num);
            } else {
              s.openWedges.set(num, { dir });
            }
          } else if (type === 'stop') {
            const open = s.openWedges.get(num);
            if (open) {
              open.dir.end = { measure: s.mi, onset };
              s.openWedges.delete(num);
            } else {
              s.pendingWedgeStops.set(num, { measure: s.mi, onset });
            }
          }
          break;
        }
        case 'words':
          words.push(text(c));
          break;
        case 'metronome': {
          const unit = childText(c, 'beat-unit') ?? 'quarter';
          const dots = childrenOf(c, 'beat-unit-dot').length;
          const bpm = childNumber(c, 'per-minute');
          if (bpm !== undefined && isNoteType(unit)) metronome = { bpm, beatUnit: notatedValue(unit, dots) };
          else ctx.ignore('metronome（テンポの数値なし）');
          break;
        }
        case 'rehearsal':
          if (s.partIndex === 0 || !s.meta.rehearsal) s.meta.rehearsal = text(c).trim();
          break;
        case 'segno':
          if (s.partIndex === 0) addJump(s.meta, 'segno');
          break;
        case 'coda':
          if (s.partIndex === 0) addJump(s.meta, 'coda');
          break;
        case 'octave-shift': {
          const num = c.attrs.number ?? '1';
          const type = c.attrs.type;
          if (type === 'up' || type === 'down') {
            const dir = make({
              kind: 'octave-shift',
              value: type,
              octaveShift: { size: Number(c.attrs.size ?? 8), type },
            });
            s.directions.push(dir);
            s.openShifts.set(num, { dir });
          } else if (type === 'stop') {
            const open = s.openShifts.get(num);
            if (open) {
              open.dir.end = { measure: s.mi, onset };
              s.openShifts.delete(num);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // テンポ：メトロノーム記号か <sound tempo>
  const soundTempo = sound?.attrs.tempo ? Number(sound.attrs.tempo) : undefined;
  if (metronome || soundTempo !== undefined) {
    const bpm = metronome ? metronome.bpm : soundTempo!;
    const beatUnit = metronome ? metronome.beatUnit : frac(1, 4);
    const textValue = words.join(' ').trim();
    if (eq(onset, ZERO) && (s.partIndex === 0 || !s.meta.tempo)) {
      s.meta.tempo = { bpm, beatUnit };
      if (textValue) s.meta.tempo.text = textValue;
      if (metronome) s.meta.tempo.metronomeShown = true;
      if (placement) s.meta.tempo.placement = placement;
    } else if (!eq(onset, ZERO)) {
      s.directions.push(make({ kind: 'tempo', value: textValue, tempo: { bpm, beatUnit } }));
    }
    words.length = 0;
  }
  if (sound && s.partIndex === 0) for (const [attr, j] of JUMP_ATTRS) if (sound.attrs[attr]) addJump(s.meta, j);

  if (words.length) {
    s.directions.push(make({ kind: 'text', value: words.join(' ') }));
  }
}

function readBarline(ctx: Ctx, e: XmlNode, meta: MeasureMeta) {
  const location = e.attrs.location ?? 'right';
  const repeat = child(e, 'repeat');
  if (repeat) {
    const dir = repeat.attrs.direction === 'forward' ? 'start' : 'end';
    meta.repeat = meta.repeat && meta.repeat !== dir ? 'both' : dir;
    if (repeat.attrs.times && dir === 'end') meta.repeatTimes = Number(repeat.attrs.times);
  }
  const ending = child(e, 'ending');
  if (ending) {
    const type = ending.attrs.type as 'start' | 'stop' | 'discontinue';
    const numbers = ending.attrs.number ?? '1';
    if (!meta.ending) meta.ending = { numbers, type };
    else if (meta.ending.type === 'start' && (type === 'stop' || type === 'discontinue')) {
      meta.ending = { numbers, type: type === 'stop' ? 'start-stop' : 'start-discontinue' };
    }
  }
  const style = childText(e, 'bar-style');
  if (style && location === 'right' && !(repeat && (style === 'light-heavy' || style === 'heavy-light'))) {
    meta.barlineRight = style;
  }
  if (child(e, 'segno')) addJump(meta, 'segno');
  if (child(e, 'coda')) addJump(meta, 'coda');
  for (const c of elements(e)) {
    if (!['repeat', 'ending', 'bar-style', 'segno', 'coda'].includes(c.tag)) ctx.ignore(`barline/${c.tag}`);
  }
}

/** 小節の拍が合わない箇所を警告する（表示は続ける） */
function checkMeasureLengths(ctx: Ctx, measures: MeasureMeta[], notes: Note[]) {
  const ends = new Map<string, Fraction>();
  for (const n of notes) {
    if (n.grace) continue;
    const key = `${n.partId}|${n.measure}|${n.staff}|${n.voice}`;
    const end = add(n.onset, n.duration);
    const prev = ends.get(key);
    if (!prev || cmp(end, prev) > 0) ends.set(key, end);
  }
  let time = measures[0]?.time ?? { beats: 4, beatType: 4 };
  const lengths = measures.map((m) => {
    if (m.time) time = m.time;
    return frac(time.beats, time.beatType);
  });
  // 小節の実際の長さ（1声部目の終わりのいちばん遅いところ）
  const actual = new Map<number, Fraction>();
  for (const [key, end] of ends) {
    if (!voiceOne(key)) continue;
    const mi = Number(key.split('|')[1]);
    const prev = actual.get(mi);
    if (!prev || cmp(end, prev) > 0) actual.set(mi, end);
  }
  // 反復記号などで1小節を2つに分けた片方：隣の小節と合わせるとちょうど1小節になる
  const splitHalf = (mi: number) =>
    [mi - 1, mi + 1].some((other) => {
      const a = actual.get(mi);
      const b = actual.get(other);
      return a && b && measures[other] && cmp(add(a, b), lengths[mi]) === 0;
    });
  const reported = new Set<number>();
  for (const [key, end] of ends) {
    const mi = Number(key.split('|')[1]);
    const m = measures[mi];
    if (!m || reported.has(mi)) continue;
    const isPickup = m.implicit || (mi === 0 && lt(end, lengths[mi])) || splitHalf(mi);
    if (
      cmp(end, lengths[mi]) > 0 ||
      (!isPickup && lt(end, lengths[mi]) && mi !== measures.length - 1 && voiceOne(key))
    ) {
      reported.add(mi);
      ctx.warn({
        code: 'measure-length',
        message: `${m.displayNumber}小節目：拍の数が拍子と合いません。`,
        partId: key.split('|')[0],
        measure: mi,
      });
    }
  }
}

// 2声部目以降は途中で終わることが多いので、拍不足のチェックは1声部目だけにする
const voiceOne = (key: string) => key.endsWith('|1');
