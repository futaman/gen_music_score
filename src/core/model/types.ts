// 内部データの型（schemaVersion 1）。音はすべて実音で持つ。仕様：docs/spec.md「データモデル」

import type { Fraction } from '../theory/fraction';
import type { Interval } from '../theory/interval';
import type { Mode } from '../theory/key';
import type { Pitch } from '../theory/pitch';

export const SCHEMA_VERSION = 1 as const;

/** MusicXML の要素をそのまま持つための木（保持のみの要素用） */
export type XmlNode = { tag: string; attrs: Record<string, string>; children: (XmlNode | string)[] };

export type Tie = { start?: boolean; stop?: boolean };

/** 和音の1音ずつ */
export type NoteHead = {
  id: string;
  pitch: Pitch; // 実音
  tie?: Tie;
  accidentalShown?: 'auto' | 'courtesy' | 'paren';
  unpitched?: boolean; // 打楽器（pitch は表示位置）
};

export type Tuplet = {
  id: string;
  actual: number;
  normal: number;
  normalType?: NoteType;
  start?: boolean;
  stop?: boolean;
  bracket?: boolean;
  showNumber?: 'actual' | 'both' | 'none';
};

export type NoteType =
  | 'maxima'
  | 'long'
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th'
  | '128th'
  | '256th'
  | '512th'
  | '1024th';

export type BeamValue = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook';

export type Origin = 'source' | 'generated' | 'edited';

export type Note = {
  id: string;
  partId: string;
  measure: number; // 小節index（0始まり）
  staff: number; // 1始まり
  voice: number; // 1始まり
  onset: Fraction; // 小節頭からの位置
  duration: Fraction; // 実際の長さ（連符なら連符適用後）。装飾音は表示上の音価
  heads: NoteHead[]; // 空なら休符、2つ以上なら和音
  /** 表示上の音符の種類。読み込んだファイルにあればそのまま持つ（なければ duration から求める） */
  notation?: { type: NoteType; dots: number };
  measureRest?: boolean; // 全休符（小節全体の休み）
  tuplets?: Tuplet[]; // 外側から順
  slurs?: { id: string; type: 'start' | 'stop' }[];
  beams?: BeamValue[]; // 連桁（レベル1から順）
  articulations: string[]; // staccato, accent, tenuto, fermata ...（トリル等の装飾記号は passthrough に持つ）
  tremolo?: { type: 'single' | 'start' | 'stop'; marks: number };
  grace?: { slash: boolean }; // 装飾音。拍の計算には含めない
  origin: Origin;
  derivedFrom?: { sectionId: string; sourcePartId: string; sourceNoteIds: string[] };
  /** 歌詞・運指など「保持のみ」の要素（MusicXMLの <note> 直下・<notations> 直下の要素） */
  passthrough?: { note?: XmlNode[]; notations?: XmlNode[] };
};

export type DirectionKind = 'dynamic' | 'wedge' | 'tempo' | 'text' | 'octave-shift' | 'pedal' | 'other';

export type Direction = {
  id: string;
  partId: string;
  measure: number;
  onset: Fraction;
  staff: number;
  kind: DirectionKind;
  /** dynamic: 'f' 'pp' など／wedge: 'crescendo' | 'diminuendo'／text: 文字列／tempo: 表示文字（なければ空） */
  value: string;
  placement?: 'above' | 'below';
  tempo?: { bpm: number; beatUnit: Fraction };
  /** wedge・octave-shift・pedal の終わり */
  end?: { measure: number; onset: Fraction };
  octaveShift?: { size: number; type: 'up' | 'down' };
  /** kind = 'other' や、うまく読めなかった direction-type をそのまま持つ */
  raw?: XmlNode[];
};

export type ClefSign = 'G' | 'F' | 'C' | 'percussion' | 'TAB' | 'none';

export type ClefChange = {
  partId: string;
  staff: number;
  measure: number;
  onset: Fraction;
  sign: ClefSign;
  line: number;
  octaveChange?: number;
};

export type Jump = 'segno' | 'coda' | 'fine' | 'dacapo' | 'dalsegno' | 'tocoda';

export type MeasureMeta = {
  index: number;
  displayNumber: string; // 表示用（"0"＝弱起、"12a" など）
  implicit?: boolean; // 弱起など番号を数えない小節
  // time・key は「この小節から変わる」ときだけ持つ（最初の小節は必ず持つ）
  time?: { beats: number; beatType: number; symbol?: 'common' | 'cut' };
  key?: { fifths: number; mode: Mode }; // 実音の調
  /** 小節頭のテンポ（小節の途中のテンポ変化は Direction の 'tempo'） */
  tempo?: { bpm: number; beatUnit: Fraction; text?: string; metronomeShown?: boolean; placement?: 'above' | 'below' };
  rehearsal?: string;
  repeat?: 'start' | 'end' | 'both';
  repeatTimes?: number;
  ending?: { numbers: string; type: 'start' | 'stop' | 'discontinue' | 'start-stop' | 'start-discontinue' };
  jumps?: Jump[];
  barlineRight?: string; // bar-style（'light-heavy' など）
};

export type Transposition = Interval; // 記譜 → 実音（B♭クラなら 長2度下 = { diatonic: -1, chromatic: -2 }）

export type Part = {
  id: string;
  name: string;
  abbr?: string;
  instrumentId: string;
  /** 楽器定義と違う移調（ホルン in E♭ など）のときだけ持つ。null は「移調しない」 */
  transposition?: Transposition | null;
  staves: number;
  keySignatureFlavor?: 'auto' | 'sharp' | 'flat';
  /** 読み込んだファイルの楽器情報（書き出し時に戻す） */
  source?: { instrumentName?: string; instrumentSound?: string; midiProgram?: number };
};

export type Score = {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  movementTitle?: string;
  composer: string;
  parts: Part[];
  measures: MeasureMeta[];
  notes: Note[];
  directions: Direction[];
  clefs: ClefChange[];
  /** パートグループの括弧など、保持だけする要素 */
  passthrough?: { partGroups?: XmlNode[]; credits?: XmlNode[] };
};

export type Role = 'melody-high' | 'melody-mid' | 'counter' | 'harmony' | 'bass' | 'rest' | 'double';

export type Arrangement = {
  id: string;
  sourceScoreId: string;
  targetScoreId: string;
  ensembleId: string;
  sections: {
    id: string;
    start: number;
    end: number; // 小節index（end は含まない）
    roles: Record<string, Role>; // 元partId → 役割
    mapping: Record<string, string[]>; // 楽器partId → 元partId
  }[];
};

export type Project = {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  updatedBy: string; // 端末ID
  sourceScore: Score;
  derivedScores: Score[];
  arrangements: Arrangement[];
  settings: Record<string, unknown>;
};
