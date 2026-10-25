// 楽器定義（config/instruments.json）の読み込みと、MusicXMLのパート情報からの楽器推定。

import instrumentsJson from '../../config/instruments.json';
import ensemblesJson from '../../config/ensembles.json';
import type { Part, Transposition } from './model/types';
import { parseInterval, withDirection, type Direction } from './theory/interval';
import { parsePitch, type Pitch } from './theory/pitch';

type InstrumentJson = (typeof instrumentsJson.instruments)[number];

export type InstrumentDef = {
  id: string;
  name: { ja: string; en: string };
  abbr: string;
  transposition: Transposition | null; // 記譜 → 実音
  range: { practical: [Pitch, Pitch]; extreme?: [Pitch, Pitch] };
  clefs: { default: string; alt?: { clef: string; above?: string; below?: string }[] };
  polyphonic: boolean;
  staves: number;
  unpitched: boolean;
  midiProgram: number;
  sample: string;
  keySignaturePolicy: 'normal' | 'none';
  match: { sounds: string[]; names: RegExp[] };
};

export type Ensemble = {
  id: string;
  name: string;
  instruments: string[];
  /** 役割ごとの担当楽器の候補（第1候補・第2候補…） */
  roles: Record<string, string[]>;
};

function toDef(j: InstrumentJson): InstrumentDef {
  const range = j.range as { practical: string[]; extreme?: string[] };
  return {
    id: j.id,
    name: j.name,
    abbr: j.abbr,
    transposition: j.transposition
      ? withDirection(parseInterval(j.transposition.interval), j.transposition.direction as Direction)
      : null,
    range: {
      practical: [parsePitch(range.practical[0]), parsePitch(range.practical[1])],
      extreme: range.extreme ? [parsePitch(range.extreme[0]), parsePitch(range.extreme[1])] : undefined,
    },
    clefs: j.clefs,
    polyphonic: j.polyphonic,
    staves: j.staves,
    unpitched: (j as { unpitched?: boolean }).unpitched ?? false,
    midiProgram: j.midiProgram,
    sample: j.sample,
    keySignaturePolicy: ((j as { keySignaturePolicy?: string }).keySignaturePolicy ?? 'normal') as 'normal' | 'none',
    match: { sounds: j.match.sounds, names: j.match.names.map((n) => new RegExp(n, 'i')) },
  };
}

export const INSTRUMENTS: readonly InstrumentDef[] = instrumentsJson.instruments.map(toDef);
export const ENSEMBLES: readonly Ensemble[] = ensemblesJson.ensembles as Ensemble[];
const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export function getInstrument(id: string): InstrumentDef {
  return BY_ID.get(id) ?? BY_ID.get('unknown')!;
}

const sameTransposition = (a: Transposition | null, b: Transposition | null) =>
  (a?.diatonic ?? 0) === (b?.diatonic ?? 0) && (a?.chromatic ?? 0) === (b?.chromatic ?? 0);

/** パートの移調（記譜 → 実音）。null なら移調しない */
export function partTransposition(part: Pick<Part, 'instrumentId' | 'transposition'>): Transposition | null {
  if (part.transposition !== undefined) return part.transposition;
  return getInstrument(part.instrumentId).transposition;
}

/** 楽器定義の移調と同じなら undefined（Part に持たない）、違えばその値 */
export function transpositionOverride(instrumentId: string, t: Transposition | null): Transposition | null | undefined {
  return sameTransposition(getInstrument(instrumentId).transposition, t) ? undefined : t;
}

/**
 * MusicXML のパート情報から楽器を推定する。
 * instrument-sound が一致するもの・名前が一致するものを候補にし、ファイルの移調と同じものを優先する。
 */
export function guessInstrument(info: {
  partName?: string;
  instrumentName?: string;
  sound?: string;
  transposition?: Transposition | null;
}): InstrumentDef {
  const names = [info.instrumentName, info.partName].filter((n): n is string => !!n?.trim()).map((n) => n.trim());
  const bySound = info.sound ? INSTRUMENTS.filter((i) => i.match.sounds.some((s) => info.sound === s)) : [];
  const bySoundPrefix =
    info.sound && bySound.length === 0
      ? INSTRUMENTS.filter((i) => i.match.sounds.some((s) => info.sound!.startsWith(s + '.')))
      : [];
  const byName = INSTRUMENTS.filter((i) => names.some((n) => i.match.names.some((re) => re.test(n))));
  const candidates = [...new Set([...bySound, ...byName, ...bySoundPrefix])];
  if (candidates.length === 0) return getInstrument('unknown');
  if (info.transposition !== undefined) {
    const same = candidates.find((c) => sameTransposition(c.transposition, info.transposition ?? null));
    if (same) return same;
  }
  return candidates[0];
}
