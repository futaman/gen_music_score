// 編曲の解析：区間の区切りと、区間ごとの各パート（段）の集計・役割の推定。純粋な関数だけ。
// 仕様：docs/spec.md「編曲機能（半自動）」「編曲の判定基準」

import thresholdsJson from '../../../config/thresholds.json';
import { getInstrument } from '../instruments';
import type { ScoreIndex } from '../model/scoreIndex';
import type { Role } from '../model/types';
import { toNumber } from '../theory/fraction';
import { midi } from '../theory/pitch';

export type ArrangeThresholds = typeof thresholdsJson.arrange;
export const THRESHOLDS: ArrangeThresholds = thresholdsJson.arrange;

/** 編曲で扱う単位。段が2つ以上のパート（ピアノなど）は段ごとに分ける。id は「partId」か「partId#段」 */
export type SourceUnit = { id: string; partId: string; staff: number };

export function sourceUnits(index: ScoreIndex): SourceUnit[] {
  const units: SourceUnit[] = [];
  for (const p of index.score.parts) {
    const def = getInstrument(p.instrumentId);
    // ティンパニ・打楽器は割当の対象外
    if (def.unpitched || def.id === 'timpani') continue;
    for (let s = 1; s <= p.staves; s++)
      units.push({ id: p.staves > 1 ? `${p.id}#${s}` : p.id, partId: p.id, staff: s });
  }
  return units;
}

type Event = { t: number; d: number; top: number; low: number };

/** 区間の中の音（時刻は区間の頭からの全音符単位） */
function unitEvents(index: ScoreIndex, unit: SourceUnit, start: number, end: number, offsets: number[]): Event[] {
  const out: Event[] = [];
  const byMeasure = index.notes.get(unit.partId) ?? [];
  for (let mi = start; mi < end; mi++) {
    for (const n of byMeasure[mi] ?? []) {
      if (n.staff !== unit.staff || n.grace || n.heads.length === 0) continue;
      const ms = n.heads.map((h) => midi(h.pitch));
      out.push({
        t: offsets[mi] - offsets[start] + toNumber(n.onset),
        d: toNumber(n.duration),
        top: Math.max(...ms),
        low: Math.min(...ms),
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export type UnitStats = {
  unitId: string;
  /** 休符の割合（0〜1） */
  restRatio: number;
  /** 平均音高（いちばん上の音、長さで重み付け）。音がなければ NaN */
  avgPitch: number;
  /** 音の数（鳴り始めの数） */
  noteCount: number;
  /** 拍の頭で最低音を受け持つ割合 */
  bassShare: number;
  /** 鳴り始めの時刻（1/48 全音符単位）→ その音（いちばん上）の高さ */
  onsets: Map<number, number>;
};

export type SectionAnalysis = { start: number; end: number; length: number; stats: UnitStats[] };

const key = (t: number) => Math.round(t * 48);

/** 小節の頭の時刻（全音符単位）。最後に曲の終わりを足す */
export function measureOffsets(index: ScoreIndex): number[] {
  const offsets = [0];
  for (const l of index.lengthAt) offsets.push(offsets[offsets.length - 1] + toNumber(l));
  return offsets;
}

export function analyzeSection(
  index: ScoreIndex,
  units: SourceUnit[],
  start: number,
  end: number,
  offsets = measureOffsets(index),
): SectionAnalysis {
  const length = offsets[end] - offsets[start];
  const events = units.map((u) => unitEvents(index, u, start, end, offsets));

  // 拍の頭ごとに、いちばん低い音を鳴らしている単位を数える
  const bassCount = units.map(() => 0);
  let beats = 0;
  for (let mi = start; mi < end; mi++) {
    const beat = 1 / index.timeAt[mi].beatType;
    for (let x = offsets[mi] - offsets[start]; x < offsets[mi + 1] - offsets[start] - 1e-9; x += beat) {
      let best = -1;
      let low = Infinity;
      events.forEach((es, ui) => {
        for (const e of es) {
          if (e.t > x + 1e-9) break;
          if (e.t + e.d > x + 1e-9 && e.low < low) {
            low = e.low;
            best = ui;
          }
        }
      });
      beats++;
      if (best >= 0) bassCount[best]++;
    }
  }

  const stats = units.map((u, ui): UnitStats => {
    const es = events[ui];
    // 鳴っている時間（重なりは1つに数える）
    let covered = 0;
    let reach = -Infinity;
    for (const e of es) {
      const from = Math.max(e.t, reach);
      if (e.t + e.d > from) covered += e.t + e.d - from;
      reach = Math.max(reach, e.t + e.d);
    }
    const weight = es.reduce((s, e) => s + e.d, 0);
    const onsets = new Map<number, number>();
    for (const e of es) onsets.set(key(e.t), Math.max(onsets.get(key(e.t)) ?? -Infinity, e.top));
    return {
      unitId: u.id,
      restRatio: length > 0 ? Math.max(0, 1 - covered / length) : 1,
      avgPitch: weight > 0 ? es.reduce((s, e) => s + e.top * e.d, 0) / weight : NaN,
      noteCount: onsets.size,
      bassShare: beats > 0 ? bassCount[ui] / beats : 0,
      onsets,
    };
  });
  return { start, end, length, stats };
}

/**
 * 区間の区切り：練習番号。なければ全休止（全パートが1小節以上休み）のあと。それもなければ8小節ごと。
 * 戻り値は区間の頭の小節index（0 から始まる）
 */
export function sectionStarts(index: ScoreIndex, units = sourceUnits(index), t = THRESHOLDS): number[] {
  const { measures } = index.score;
  const count = measures.length;
  const rehearsal = measures.flatMap((m, i) => (i > 0 && m.rehearsal ? [i] : []));
  if (rehearsal.length > 0) return [0, ...rehearsal];

  const silent = (mi: number) =>
    units.every((u) =>
      (index.notes.get(u.partId)?.[mi] ?? []).every((n) => n.staff !== u.staff || n.heads.length === 0),
    );
  const pauses: number[] = [];
  for (let mi = 1; mi < count; mi++) if (silent(mi - 1) && !silent(mi)) pauses.push(mi);
  if (pauses.length > 0) return [0, ...pauses];

  const starts: number[] = [];
  for (let mi = 0; mi < count; mi += t.sectionFallbackMeasures) starts.push(mi);
  return starts;
}

/** 2つの単位のリズムの一致度（鳴り始めの集合の重なり：共通 ÷ 和集合） */
export function rhythmMatch(a: UnitStats, b: UnitStats): number {
  if (a.onsets.size === 0 || b.onsets.size === 0) return 0;
  let common = 0;
  for (const k of a.onsets.keys()) if (b.onsets.has(k)) common++;
  return common / (a.onsets.size + b.onsets.size - common);
}

/** 同時に鳴り始める音のうち、同じ音名（ユニゾンかオクターブ）の割合 */
function pitchClassMatch(a: UnitStats, b: UnitStats): number {
  let common = 0;
  let same = 0;
  for (const [k, p] of a.onsets) {
    const q = b.onsets.get(k);
    if (q === undefined) continue;
    common++;
    if ((((p - q) % 12) + 12) % 12 === 0) same++;
  }
  return common > 0 ? same / common : 0;
}

/** 役割の推定（docs/spec.md「編曲の判定基準」） */
export function estimateRoles(stats: UnitStats[], t = THRESHOLDS): Record<string, Role> {
  const roles: Record<string, Role> = {};
  const active = stats.filter((s) => s.restRatio < t.restRatio && s.noteCount > 0);
  for (const s of stats) if (!active.includes(s)) roles[s.unitId] = 'rest';
  if (active.length === 0) return roles;

  // 旋律：音の数が中央値以上の中で、平均音高がいちばん高い
  const counts = active.map((s) => s.noteCount).sort((a, b) => a - b);
  const median = counts[Math.floor((counts.length - 1) / 2)];
  const melody = active.filter((s) => s.noteCount >= median).reduce((a, b) => (b.avgPitch > a.avgPitch ? b : a));
  roles[melody.unitId] = melody.avgPitch >= t.melodyHighMidi ? 'melody-high' : 'melody-mid';

  // バス：拍の頭で最低音を受け持つ割合がいちばん高い（旋律以外）
  const others = active.filter((s) => s !== melody);
  const bass = others.length > 0 ? others.reduce((a, b) => (b.bassShare > a.bassShare ? b : a)) : undefined;
  if (bass && bass.bassShare > 0) roles[bass.unitId] = 'bass';

  // 残り：重複 → 対旋律 → 和声
  const leaders = [melody, ...(bass && roles[bass.unitId] === 'bass' ? [bass] : [])];
  for (const s of others) {
    if (roles[s.unitId]) continue;
    const doubles = leaders.some(
      (l) => rhythmMatch(s, l) >= t.doubleRhythmMatch && pitchClassMatch(s, l) >= t.doublePitchMatch,
    );
    if (doubles) roles[s.unitId] = 'double';
    else if (
      rhythmMatch(s, melody) < t.counterRhythmMatchMax &&
      s.noteCount >= melody.noteCount * t.counterNoteRatioMin
    )
      roles[s.unitId] = 'counter';
    else roles[s.unitId] = 'harmony';
  }
  return roles;
}
