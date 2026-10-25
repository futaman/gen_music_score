// 内部データの一部（小節の範囲 × 表示するパート）を、Verovio で描くための MEI にする。
// 区切りをまたぐタイ・スラー・ヘアピンは、前側を「小節線まで」、後ろ側を「小節の頭から」で描く
//（docs/decisions/0001-renderer.md）。

import { getInstrument, partTransposition } from '../instruments';
import { planAccidentals, spellWith, writtenSpelling, type PitchMode } from '../model/display';
import { autoBeamGroups } from '../model/beaming';
import { notationFor, NOTE_TYPE_VALUES, tupletRatio } from '../model/notation';
import { clefAt, type ScoreIndex } from '../model/scoreIndex';
import type { ClefChange, Direction, Note, NoteType, Part, Transposition } from '../model/types';
import { add, cmp, frac, isZero, sub, toNumber, ZERO, type Fraction } from '../theory/fraction';
import type { Key } from '../theory/key';
import { noteName, type NoteNameStyle } from '../theory/names';
import { midi, type Pitch } from '../theory/pitch';
import { attrsToString, escapeXml } from '../musicxml/xml';

export type ChunkOptions = {
  start: number; // 小節index（含む）
  end: number; // 小節index（含まない）
  partIds: string[]; // 表示するパート（この順で上から）
  pitchMode: PitchMode;
  /** 楽器名：最初の段は正式名、2つ目以降のチャンクは略称にする */
  labels: 'full' | 'abbr' | 'none';
  /** 音名を音符の下に書く */
  noteNames?: NoteNameStyle;
  /** パートごとの色（partId → CSSの色） */
  colors?: Record<string, string>;
  /** 音ごとの色（NoteHead.id → CSSの色）。音域外の警告など。パートの色より優先 */
  headColors?: Record<string, string>;
  /** 調号を書かず臨時記号で書くパート（ホルンの慣習。記譜音で表示するときだけ） */
  noKeySignatureParts?: string[];
};

const MEI_DUR: Record<NoteType, string> = {
  maxima: 'maxima',
  long: 'long',
  breve: 'breve',
  whole: '1',
  half: '2',
  quarter: '4',
  eighth: '8',
  '16th': '16',
  '32nd': '32',
  '64th': '64',
  '128th': '128',
  '256th': '256',
  '512th': '512',
  '1024th': '1024',
};

const ARTIC: Record<string, string> = {
  staccato: 'stacc',
  staccatissimo: 'stacciss',
  accent: 'acc',
  'strong-accent': 'marc',
  tenuto: 'ten',
  'detached-legato': 'ten-stacc',
  spiccato: 'spicc',
  stress: 'stress',
  unstress: 'unstress',
};

const ACCID: Record<number, string> = { [-2]: 'ff', [-1]: 'f', 0: 'n', 1: 's', 2: 'x' };

const tag = (name: string, attrs: Record<string, string | number | undefined> = {}, body?: string) =>
  body === undefined ? `<${name}${attrsToString(attrs)}/>` : `<${name}${attrsToString(attrs)}>${body}</${name}>`;

const keySig = (fifths: number) => (fifths === 0 ? '0' : fifths > 0 ? `${fifths}s` : `${-fifths}f`);
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

type StaffInfo = { n: number; part: Part; staff: number; t: Transposition | null; unpitched: boolean };

/** 表示するパートの段に、上から通し番号を付ける */
export function staffLayout(index: ScoreIndex, partIds: string[]): StaffInfo[] {
  const staves: StaffInfo[] = [];
  for (const id of partIds) {
    const part = index.score.parts.find((p) => p.id === id);
    if (!part) continue;
    const def = getInstrument(part.instrumentId);
    for (let s = 1; s <= part.staves; s++) {
      staves.push({ n: staves.length + 1, part, staff: s, t: partTransposition(part), unpitched: def.unpitched });
    }
  }
  return staves;
}

/** 段数に応じたチャンクの小節数（docs/decisions/0001-renderer.md：段数 × 小節数 ≒ 36） */
export function chunkSize(staffCount: number): number {
  return Math.max(2, Math.min(16, Math.floor(36 / Math.max(1, staffCount))));
}

export function chunkToMei(index: ScoreIndex, opts: ChunkOptions): string {
  const { score } = index;
  const staves = staffLayout(index, opts.partIds);
  const w = new MeiWriter(index, opts, staves);
  const body: string[] = [];
  let inEnding = false;
  for (let mi = opts.start; mi < opts.end; mi++) {
    const meta = score.measures[mi];
    if (mi > opts.start && (meta.key || meta.time)) body.push(w.scoreDefChange(mi));
    if (meta.ending?.type.startsWith('start')) {
      if (inEnding) body.push('</ending>');
      body.push(`<ending n="${escapeXml(meta.ending.numbers)}" label="${escapeXml(meta.ending.numbers)}.">`);
      inEnding = true;
    } else if (!inEnding && meta.ending && mi === opts.start) {
      body.push(`<ending n="${escapeXml(meta.ending.numbers)}">`);
      inEnding = true;
    }
    body.push(w.measure(mi));
    if (inEnding && meta.ending && meta.ending.type !== 'start') {
      body.push('</ending>');
      inEnding = false;
    }
  }
  if (inEnding) body.push('</ending>');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">' +
    '<meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead>' +
    `<music><body><mdiv><score>${w.scoreDef()}<section>${body.join('')}</section></score></mdiv></body></music></mei>`
  );
}

class MeiWriter {
  constructor(
    private index: ScoreIndex,
    private opts: ChunkOptions,
    private staves: StaffInfo[],
  ) {}

  /** いま書いている小節（記譜音の綴りはその小節の調で決まる） */
  private mi = 0;

  private spelling(s: StaffInfo, concert: Key) {
    return writtenSpelling(concert, s.t, s.part.keySignatureFlavor ?? 'auto');
  }

  private pitchOf(s: StaffInfo, p: Pitch): Pitch {
    if (this.opts.pitchMode !== 'written' || s.unpitched) return p;
    return spellWith(p, this.spelling(s, this.index.keyAt[this.mi]).interval);
  }

  private keyOf(s: StaffInfo, concert: Key): number {
    if (s.unpitched) return 0;
    if (this.opts.pitchMode === 'written' && this.opts.noKeySignatureParts?.includes(s.part.id)) return 0;
    return this.opts.pitchMode === 'written' ? this.spelling(s, concert).key.fifths : concert.fifths;
  }

  private clefAttrs(c: ClefChange | undefined, prefix: 'clef.' | ''): Record<string, string | number | undefined> {
    const sign = c?.sign ?? 'G';
    if (sign === 'percussion') return { [`${prefix}shape`]: 'perc' };
    const a: Record<string, string | number | undefined> = {
      [`${prefix}shape`]: sign === 'TAB' || sign === 'none' ? 'G' : sign,
      [`${prefix}line`]: c?.line ?? 2,
    };
    if (c?.octaveChange) {
      a[`${prefix}dis`] = Math.abs(c.octaveChange) >= 2 ? 15 : 8;
      a[`${prefix}dis.place`] = c.octaveChange > 0 ? 'above' : 'below';
    }
    return a;
  }

  scoreDef(): string {
    const { start } = this.opts;
    const time = this.index.timeAt[start];
    const meta = this.index.score.measures[start];
    const showMeter = start === 0 || !!meta.time;
    const groups: string[] = [];
    let i = 0;
    while (i < this.staves.length) {
      const part = this.staves[i].part;
      const partStaves = this.staves.filter((s) => s.part === part);
      const label = this.label(part);
      const defs = partStaves.map((s) => {
        const clef = clefAt(this.index, part.id, s.staff, start, ZERO);
        const children = [
          tag('keySig', { sig: keySig(this.keyOf(s, this.index.keyAt[start])) }),
          tag('meterSig', {
            count: time.beats,
            unit: time.beatType,
            visible: showMeter ? undefined : 'false',
            sym: meta.time?.symbol === 'common' ? 'common' : meta.time?.symbol === 'cut' ? 'cut' : undefined,
          }),
        ];
        if (partStaves.length === 1 && label) children.unshift(this.labelXml(part, label));
        return tag('staffDef', { n: s.n, lines: 5, ...this.clefAttrs(clef, 'clef.') }, children.join(''));
      });
      if (partStaves.length > 1) {
        groups.push(
          tag(
            'staffGrp',
            { symbol: 'brace', 'bar.thru': 'true' },
            (label ? this.labelXml(part, label) : '') + defs.join(''),
          ),
        );
      } else groups.push(defs[0]);
      i += partStaves.length;
    }
    return tag('scoreDef', {}, tag('staffGrp', { symbol: 'bracket', 'bar.thru': 'true' }, groups.join('')));
  }

  /** 段の頭の楽器名。2段目以降は略称にして、どの段も同じ字下げにそろえる */
  private labelXml(part: Part, label: string): string {
    const def = getInstrument(part.instrumentId);
    const abbr = part.abbr || def.abbr || label;
    // Verovio は日本語の文字幅を狭く見積もり、段の左で切れてしまうので、日本語の名前は略称にする
    const full = /[^\u0020-\u007E♭♯]/.test(label) ? abbr : label;
    return tag('label', {}, escapeXml(full)) + tag('labelAbbr', {}, escapeXml(abbr));
  }

  private label(part: Part): string {
    if (this.opts.labels === 'none') return '';
    const def = getInstrument(part.instrumentId);
    if (this.opts.labels === 'abbr') return part.abbr || def.abbr || part.name;
    return part.name || def.name.ja;
  }

  /** 曲の途中の調号・拍子の変更 */
  scoreDefChange(mi: number): string {
    const meta = this.index.score.measures[mi];
    const defs = this.staves.map((s) => {
      const c: string[] = [];
      if (meta.key) c.push(tag('keySig', { sig: keySig(this.keyOf(s, meta.key)) }));
      if (meta.time) c.push(tag('meterSig', { count: meta.time.beats, unit: meta.time.beatType }));
      return tag('staffDef', { n: s.n }, c.join(''));
    });
    return tag('scoreDef', {}, tag('staffGrp', {}, defs.join('')));
  }

  measure(mi: number): string {
    this.mi = mi;
    const { score } = this.index;
    const meta = score.measures[mi];
    const attrs: Record<string, string | undefined> = { 'xml:id': `m${mi}`, n: meta.displayNumber };
    if (meta.repeat === 'start' || meta.repeat === 'both') attrs.left = 'rptstart';
    if (meta.repeat === 'end' || meta.repeat === 'both') attrs.right = 'rptend';
    else if (meta.barlineRight === 'light-heavy') attrs.right = 'end';
    else if (meta.barlineRight === 'light-light') attrs.right = 'dbl';
    else if (meta.barlineRight === 'dashed') attrs.right = 'dashed';
    else if (meta.barlineRight === 'none') attrs.right = 'invis';
    if (meta.implicit) attrs.metcon = 'false';

    const staffXml: string[] = [];
    const controls: string[] = [];
    const partsDone = new Set<string>();
    for (const s of this.staves) {
      const all = this.index.notes.get(s.part.id)?.[mi] ?? [];
      const notes = all.filter((n) => n.staff === s.staff);
      const keyFifths = this.keyOf(s, this.index.keyAt[mi]);
      const accidentals = planAccidentals(notes, keyFifths, (p) => this.pitchOf(s, p));
      staffXml.push(
        tag('staff', { 'xml:id': `s${mi}-${s.part.id}-${s.staff}`, n: s.n }, this.layers(s, mi, notes, accidentals)),
      );
      controls.push(...this.noteControls(s, mi, notes));
      if (!partsDone.has(s.part.id)) {
        partsDone.add(s.part.id);
        controls.push(...this.directionControls(s, mi));
      }
    }
    controls.push(...this.measureControls(mi));
    return tag('measure', attrs, staffXml.join('') + controls.join(''));
  }

  private layers(s: StaffInfo, mi: number, notes: Note[], accidentals: Map<string, number | null>): string {
    const byVoice = new Map<number, Note[]>();
    for (const n of notes) {
      let arr = byVoice.get(n.voice);
      if (!arr) byVoice.set(n.voice, (arr = []));
      arr.push(n);
    }
    // この段の音部記号の変化（小節途中）と、次の小節の頭での変化（この小節の終わりに書く）
    const clefs = (this.index.clefs.get(s.part.id) ?? []).filter(
      (c) => c.staff === s.staff && c.measure === mi && !isZero(c.onset),
    );
    const nextClef =
      mi + 1 < this.opts.end
        ? (this.index.clefs.get(s.part.id) ?? []).find(
            (c) => c.staff === s.staff && c.measure === mi + 1 && isZero(c.onset),
          )
        : undefined;

    if (byVoice.size === 0) {
      return tag('layer', { n: 1 }, tag('mRest') + (nextClef ? tag('clef', this.clefAttrs(nextClef, '')) : ''));
    }
    const voices = [...byVoice.keys()].sort((a, b) => a - b);
    return voices
      .map((v, vi) => {
        const content = this.layerContent(s, mi, byVoice.get(v)!, accidentals, vi === 0 ? clefs : []);
        const tail = vi === 0 && nextClef ? tag('clef', this.clefAttrs(nextClef, '')) : '';
        return tag('layer', { n: v }, content + tail);
      })
      .join('');
  }

  private layerContent(
    s: StaffInfo,
    mi: number,
    notes: Note[],
    accidentals: Map<string, number | null>,
    clefs: ClefChange[],
  ): string {
    // 装飾音は次の主音とひとまとまりにする（連符の切れ目にならないように）
    type Unit = { graces: Note[]; main?: Note; onset: Fraction };
    const units: Unit[] = [];
    let graces: Note[] = [];
    for (const n of notes) {
      if (n.grace) graces.push(n);
      else {
        units.push({ graces, main: n, onset: n.onset });
        graces = [];
      }
    }
    if (graces.length) units.push({ graces, onset: graces[0].onset });

    const groups = tupletGroups(units.map((u) => u.main));
    const out: string[] = [];
    let cursor: Fraction = ZERO;
    let ci = 0;
    const flushClefs = (upTo: Fraction) => {
      while (ci < clefs.length && cmp(clefs[ci].onset, upTo) <= 0)
        out.push(tag('clef', this.clefAttrs(clefs[ci++], '')));
    };
    const singleVoiceMeasureRest = notes.length === 1 && !!notes[0].measureRest;

    let ui = 0;
    while (ui < units.length) {
      const u = units[ui];
      if (cmp(u.onset, cursor) > 0) {
        flushClefs(u.onset);
        out.push(...spaces(sub(u.onset, cursor)));
        cursor = u.onset;
      }
      flushClefs(u.onset);
      const group = u.main ? groups.get(u.main) : undefined;
      if (group && group.first === u.main) {
        // 連符：このまとまりに入るユニットを集める
        const members: Unit[] = [];
        while (ui < units.length && units[ui].main && groups.get(units[ui].main!) === group) members.push(units[ui++]);
        out.push(this.tuplet(s, mi, members, accidentals, 0, singleVoiceMeasureRest));
        const last = members[members.length - 1].main!;
        cursor = add(last.onset, last.duration);
        continue;
      }
      out.push(this.unit(s, u, accidentals, singleVoiceMeasureRest));
      if (u.main) cursor = add(u.main.onset, u.main.duration);
      ui++;
    }
    flushClefs(frac(1000));
    return out.join('');
  }

  private tuplet(
    s: StaffInfo,
    mi: number,
    members: { graces: Note[]; main?: Note }[],
    accidentals: Map<string, number | null>,
    level: number,
    mRest: boolean,
  ): string {
    const t = members[0].main!.tuplets![level];
    // 内側の連符
    const inner = members.map((m) => m.main!.tuplets?.[level + 1]);
    const parts: string[] = [];
    let i = 0;
    while (i < members.length) {
      const it = inner[i];
      if (it) {
        const sub: typeof members = [];
        while (i < members.length && inner[i]?.id === it.id) sub.push(members[i++]);
        parts.push(this.tuplet(s, mi, sub, accidentals, level + 1, mRest));
      } else {
        parts.push(this.unit(s, members[i], accidentals, mRest));
        i++;
      }
    }
    const attrs: Record<string, string | number | undefined> = { num: t.actual, numbase: t.normal };
    if (t.bracket === false) attrs['bracket.visible'] = 'false';
    if (t.showNumber === 'none') attrs['num.visible'] = 'false';
    if (t.showNumber === 'both') attrs['num.format'] = 'ratio';
    return tag('tuplet', attrs, parts.join(''));
  }

  private unit(
    s: StaffInfo,
    u: { graces: Note[]; main?: Note },
    accidentals: Map<string, number | null>,
    mRest: boolean,
  ): string {
    return [...u.graces, ...(u.main ? [u.main] : [])].map((n) => this.event(s, n, accidentals, mRest)).join('');
  }

  private event(s: StaffInfo, n: Note, accidentals: Map<string, number | null>, mRest: boolean): string {
    if (n.heads.length === 0) {
      const color = this.opts.colors?.[n.partId];
      if (n.measureRest && mRest) return tag('mRest', { 'xml:id': n.id, color });
      return tag('rest', { 'xml:id': n.id, ...this.durAttrs(n), color });
    }
    const common: Record<string, string | number | undefined> = {};
    if (n.grace) common.grace = n.grace.slash ? 'acc' : 'unacc';
    const color = this.opts.colors?.[n.partId];
    if (color) common.color = color;
    // 音名は和音ならいちばん上の音だけ
    const named =
      this.opts.noteNames && !s.unpitched
        ? n.heads.reduce((a, b) => (midi(b.pitch) > midi(a.pitch) ? b : a))
        : undefined;
    const artics = n.articulations.map((a) => ARTIC[a]).filter(Boolean);
    const articXml = artics.length ? tag('artic', { artic: artics.join(' ') }) : '';
    const tremolo = n.tremolo?.type === 'single' ? n.tremolo.marks : 0;
    const head = (h: Note['heads'][number], withDur: boolean) => {
      const p = this.pitchOf(s, h.pitch);
      const a: Record<string, string | number | undefined> = {
        'xml:id': h.id,
        pname: p.step.toLowerCase(),
        oct: p.octave,
        ...(withDur ? { ...this.durAttrs(n), ...common } : {}),
      };
      const acc = accidentals.get(h.id);
      let inner = '';
      if (acc !== null && acc !== undefined) {
        const accAttrs: Record<string, string> = { accid: ACCID[acc] };
        if (h.accidentalShown === 'courtesy') accAttrs.func = 'caution';
        if (h.accidentalShown === 'paren') accAttrs.enclose = 'paren';
        inner += tag('accid', accAttrs);
      } else if (p.alter !== 0) {
        a['accid.ges'] = ACCID[p.alter];
      }
      if (withDur && tremolo) a['stem.mod'] = `${tremolo}slash`;
      if (!withDur && color) a.color = color;
      const warn = this.opts.headColors?.[h.id];
      if (warn) a.color = warn;
      if (withDur) inner += articXml;
      if (h === named && !n.grace)
        inner += tag('verse', { n: 1 }, tag('syl', {}, escapeXml(noteName(p, this.opts.noteNames!))));
      return tag('note', a, inner);
    };
    let xml: string;
    if (n.heads.length === 1) xml = head(n.heads[0], true);
    else {
      const chordAttrs: Record<string, string | number | undefined> = {
        'xml:id': n.id,
        ...this.durAttrs(n),
        ...common,
      };
      if (tremolo) chordAttrs['stem.mod'] = `${tremolo}slash`;
      xml = tag('chord', chordAttrs, n.heads.map((h) => head(h, false)).join('') + articXml);
    }
    return tremolo ? tag('bTrem', {}, xml) : xml;
  }

  private durAttrs(n: Note): Record<string, string | number | undefined> {
    const notation = n.notation ?? notationFor(n.duration, tupletRatio(n)) ?? { type: 'quarter' as NoteType, dots: 0 };
    return { dur: MEI_DUR[notation.type], dots: notation.dots || undefined };
  }

  /** 音符に付く線（タイ・スラー・連桁・フェルマータ） */
  private noteControls(s: StaffInfo, mi: number, notes: Note[]): string[] {
    const out: string[] = [];
    const lastMi = this.opts.end - 1;
    const tsEnd = (fromMi: number) => `${lastMi - fromMi}m+${this.index.timeAt[lastMi].beats + 1}`;
    const elId = (n: Note) => (n.heads.length === 1 ? n.heads[0].id : n.id);

    for (const n of notes) {
      for (const h of n.heads) {
        if (h.tie?.start) {
          const end = this.index.tieEnd.get(h.id);
          if (end && end.measure < this.opts.end)
            out.push(tag('tie', { startid: `#${h.id}`, endid: `#${end.headId}` }));
          else if (end) out.push(tag('tie', { startid: `#${h.id}`, tstamp2: tsEnd(mi) }));
        }
        // 前のチャンクから来たタイ
        if (h.tie?.stop && mi === this.opts.start && isZero(n.onset)) {
          out.push(tag('tie', { staff: s.n, tstamp: '0', endid: `#${h.id}` }));
        }
      }
      for (const sl of n.slurs ?? []) {
        const pair = this.index.slurs.get(sl.id);
        if (sl.type === 'start') {
          const stop = pair?.stop;
          if (!stop) continue;
          if (stop.measure < this.opts.end && stop.measure >= mi)
            out.push(tag('slur', { startid: `#${elId(n)}`, endid: `#${elId(stop)}` }));
          else if (stop.measure >= this.opts.end) out.push(tag('slur', { startid: `#${elId(n)}`, tstamp2: tsEnd(mi) }));
        } else if (pair?.start && pair.start.measure < this.opts.start) {
          out.push(tag('slur', { staff: s.n, tstamp: '0', endid: `#${elId(n)}` }));
        }
      }
      if (n.articulations.includes('fermata') || n.articulations.includes('fermata-inverted')) {
        out.push(
          tag('fermata', {
            startid: `#${elId(n)}`,
            form: n.articulations.includes('fermata-inverted') ? 'inv' : undefined,
          }),
        );
      }
    }
    // 連桁：声部ごとに begin〜end をつなぐ
    const byVoice = new Map<number, Note[]>();
    for (const n of notes) if (!n.grace) (byVoice.get(n.voice) ?? byVoice.set(n.voice, []).get(n.voice)!).push(n);
    for (const list of byVoice.values()) {
      // ファイルに連桁の情報がなければ、拍ごとに自動でつなぐ
      if (!list.some((n) => n.beams?.length)) {
        for (const g of autoBeamGroups(list, this.index.timeAt[mi])) {
          const ids = g.map(elId);
          out.push(
            tag('beamSpan', {
              startid: `#${ids[0]}`,
              endid: `#${ids[ids.length - 1]}`,
              plist: ids.map((i) => `#${i}`).join(' '),
            }),
          );
        }
        continue;
      }
      let group: Note[] = [];
      for (const n of list) {
        const b = n.beams?.[0];
        if (b === 'begin') group = [n];
        else if (b === 'continue' && group.length) group.push(n);
        else if (b === 'end' && group.length) {
          group.push(n);
          const ids = group.map(elId);
          out.push(
            tag('beamSpan', {
              startid: `#${ids[0]}`,
              endid: `#${ids[ids.length - 1]}`,
              plist: ids.map((i) => `#${i}`).join(' '),
            }),
          );
          group = [];
        }
      }
    }
    return out;
  }

  /** 強弱・ヘアピン・文字・テンポ（パートの最初の段に付ける） */
  private directionControls(s: StaffInfo, mi: number): string[] {
    const out: string[] = [];
    const beatType = this.index.timeAt[mi].beatType;
    const tstamp = (onset: Fraction) => fmt(toNumber(onset) * beatType + 1);
    const staffOf = (d: Direction) => this.staves.find((x) => x.part === s.part && x.staff === d.staff)?.n ?? s.n;
    const lastMi = this.opts.end - 1;
    for (const d of this.index.directions.get(s.part.id)?.[mi] ?? []) {
      const place = d.placement;
      switch (d.kind) {
        case 'dynamic':
          out.push(tag('dynam', { staff: staffOf(d), tstamp: tstamp(d.onset), place }, escapeXml(d.value)));
          break;
        case 'text':
          out.push(tag('dir', { staff: staffOf(d), tstamp: tstamp(d.onset), place }, escapeXml(d.value)));
          break;
        case 'tempo':
          out.push(
            tag(
              'tempo',
              { staff: staffOf(d), tstamp: tstamp(d.onset), mm: d.tempo?.bpm },
              escapeXml(d.value || `♩=${d.tempo?.bpm}`),
            ),
          );
          break;
        case 'wedge': {
          if (!d.end) break;
          const endMi = Math.min(d.end.measure, lastMi);
          const endBeat =
            d.end.measure > lastMi
              ? this.index.timeAt[lastMi].beats + 1
              : toNumber(d.end.onset) * this.index.timeAt[endMi].beatType + 1;
          out.push(
            tag('hairpin', {
              form: d.value === 'crescendo' ? 'cres' : 'dim',
              staff: staffOf(d),
              tstamp: tstamp(d.onset),
              tstamp2: `${endMi - mi}m+${fmt(endBeat)}`,
              place,
            }),
          );
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** 練習番号・小節頭のテンポ（いちばん上の段に付ける） */
  private measureControls(mi: number): string[] {
    const meta = this.index.score.measures[mi];
    const out: string[] = [];
    const top = this.staves[0]?.n ?? 1;
    if (meta.rehearsal)
      out.push(tag('reh', { staff: top, tstamp: '1' }, tag('rend', { rend: 'box' }, escapeXml(meta.rehearsal))));
    if (meta.tempo) {
      const text = [meta.tempo.text, meta.tempo.metronomeShown ? `♩=${meta.tempo.bpm}` : ''].filter(Boolean).join(' ');
      if (text) out.push(tag('tempo', { staff: top, tstamp: '1', mm: meta.tempo.bpm }, escapeXml(text)));
    }
    if (meta.jumps?.includes('segno')) out.push(tag('dir', { staff: top, tstamp: '1' }, '𝄋'));
    if (meta.jumps?.includes('coda')) out.push(tag('dir', { staff: top, tstamp: '1' }, '𝄌'));
    if (meta.jumps?.includes('fine'))
      out.push(tag('dir', { staff: top, tstamp: fmt(this.index.timeAt[mi].beats + 0.5) }, 'Fine'));
    if (meta.jumps?.includes('dacapo'))
      out.push(tag('dir', { staff: top, tstamp: fmt(this.index.timeAt[mi].beats + 0.5) }, 'D.C.'));
    if (meta.jumps?.includes('dalsegno'))
      out.push(tag('dir', { staff: top, tstamp: fmt(this.index.timeAt[mi].beats + 0.5) }, 'D.S.'));
    return out;
  }
}

/** 隙間を、表せる長さの休み（見えない）で埋める */
function spaces(gap: Fraction): string[] {
  const out: string[] = [];
  let rest = gap;
  for (const [value, dur] of [
    [frac(1), '1'],
    [frac(1, 2), '2'],
    [frac(1, 4), '4'],
    [frac(1, 8), '8'],
    [frac(1, 16), '16'],
    [frac(1, 32), '32'],
    [frac(1, 64), '64'],
    [frac(1, 128), '128'],
  ] as const) {
    while (cmp(rest, value) >= 0) {
      out.push(tag('space', { dur }));
      rest = sub(rest, value);
    }
  }
  return out;
}

type Group = { first: Note };

/**
 * 連符のまとまり（いちばん外側）を求める。
 * 括弧の始まり・終わりがあるものは id で、time-modification だけのものは「同じ比が続き、1組分の長さになるまで」でまとめる。
 */
function tupletGroups(mains: (Note | undefined)[]): Map<Note, Group> {
  const result = new Map<Note, Group>();
  let current: { group: Group; id?: string; ratio?: string; filled?: Fraction; full?: Fraction } | null = null;
  for (const n of mains) {
    const t = n?.tuplets?.[0];
    if (!n || !t) {
      current = null;
      continue;
    }
    const explicit = t.start || t.stop || n.tuplets!.length > 1;
    const ratio = `${t.actual}/${t.normal}`;
    if (explicit) {
      if (!current || current.id !== t.id) current = { group: { first: n }, id: t.id };
      result.set(n, current.group);
      if (t.stop) current = null;
      continue;
    }
    // 括弧の情報がない連符：1組分 = normal × （normal-type か、この音の見かけの長さ）
    const shown = toNumberFraction(n);
    if (
      !current ||
      current.ratio !== ratio ||
      (current.filled && current.full && cmp(current.filled, current.full) >= 0)
    ) {
      const unit = t.normalType ? NOTE_TYPE_VALUES[t.normalType] : shown;
      current = { group: { first: n }, ratio, filled: ZERO, full: frac(unit.num * t.normal, unit.den) };
    }
    result.set(n, current.group);
    current.filled = add(current.filled ?? ZERO, shown);
  }
  return result;
}

/** 連符の中での見かけの長さ（3連8分なら 1/8） */
function toNumberFraction(n: Note): Fraction {
  const r = tupletRatio(n);
  return frac(n.duration.num * r.den, n.duration.den * r.num);
}
