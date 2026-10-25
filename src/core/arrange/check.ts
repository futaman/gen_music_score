// 編曲の警告（演奏しやすさのチェック）。編集のたびに出し直せるよう、編成の楽譜だけから計算する（旋律の欠けだけは元の楽譜も使う）。
// 仕様：docs/spec.md「警告の種類」「編曲の判定基準」

import thresholdsJson from '../../../config/thresholds.json';
import { checkRanges } from '../check/range';
import { getInstrument } from '../instruments';
import { buildScoreIndex } from '../model/scoreIndex';
import type { Arrangement, Note, Score } from '../model/types';
import { toNumber } from '../theory/fraction';
import { midi } from '../theory/pitch';
import { measureOffsets } from './analyze';

export type WarningThresholds = typeof thresholdsJson.warnings;
export const WARNING_THRESHOLDS: WarningThresholds = thresholdsJson.warnings;

export type ArrangeWarningKind = 'range' | 'edge' | 'breath' | 'leap' | 'horn-high' | 'melody-missing';

export type ArrangeWarning = {
  kind: ArrangeWarningKind;
  partId: string;
  /** 小節index の範囲（end は含まない） */
  start: number;
  end: number;
  noteIds: string[];
  message: string;
};

const DEFAULT_TEMPO = 100; // 4分音符／分。楽譜にテンポがないとき

/** 小節ごとの「全音符1つの秒数」 */
function secondsPerWhole(score: Score): number[] {
  let quarterBpm = DEFAULT_TEMPO;
  const tempoDirs = new Map<number, number>();
  for (const d of score.directions)
    if (d.kind === 'tempo' && d.tempo) tempoDirs.set(d.measure, d.tempo.bpm * (toNumber(d.tempo.beatUnit) / 0.25));
  return score.measures.map((m, i) => {
    if (m.tempo) quarterBpm = m.tempo.bpm * (toNumber(m.tempo.beatUnit) / 0.25);
    else if (tempoDirs.has(i)) quarterBpm = tempoDirs.get(i)!;
    return 240 / quarterBpm;
  });
}

/** パートの音を時間順に（装飾音は除く） */
function line(score: Score, partId: string): Note[] {
  return score.notes
    .filter((n) => n.partId === partId && !n.grace)
    .sort((a, b) => a.measure - b.measure || toNumber(a.onset) - toNumber(b.onset));
}

const pitchOf = (n: Note) => Math.max(...n.heads.map((h) => midi(h.pitch)));
const span = (ns: Note[]) => ({
  start: ns[0].measure,
  end: ns[ns.length - 1].measure + 1,
  noteIds: ns.map((n) => n.id),
});

export function checkArrangement(
  score: Score,
  opts: { source?: Score; arrangement?: Arrangement; thresholds?: WarningThresholds } = {},
): ArrangeWarning[] {
  const t = opts.thresholds ?? WARNING_THRESHOLDS;
  const warnings: ArrangeWarning[] = [];
  const index = buildScoreIndex(score);
  const offsets = measureOffsets(index);
  const spw = secondsPerWhole(score);

  // 音域外（音ごと）
  const outside = checkRanges(score);
  const byPart = new Map<string, typeof outside>();
  for (const r of outside) byPart.set(r.partId, [...(byPart.get(r.partId) ?? []), r]);
  for (const [partId, rs] of byPart) {
    // 続いている小節はまとめて1件にする
    let group: typeof rs = [];
    const flush = () => {
      if (!group.length) return;
      warnings.push({
        kind: 'range',
        partId,
        start: group[0].measure,
        end: group[group.length - 1].measure + 1,
        noteIds: group.map((g) => g.noteId),
        message: `音域外の音が${group.length}つ`,
      });
      group = [];
    };
    for (const r of rs.sort((a, b) => a.measure - b.measure)) {
      if (group.length && r.measure > group[group.length - 1].measure + 1) flush();
      group.push(r);
    }
    flush();
  }

  for (const part of score.parts) {
    const def = getInstrument(part.instrumentId);
    if (def.unpitched) continue;
    const ns = line(score, part.id);
    const [lo, hi] = def.range.practical.map(midi);

    // 息継ぎ：休みなしで一定の秒数以上
    let run: Note[] = [];
    let seconds = 0;
    const breath = () => {
      if (run.length && seconds >= t.breathSeconds)
        warnings.push({
          kind: 'breath',
          partId: part.id,
          ...span(run),
          message: `休みなしで約${Math.round(seconds)}秒（息継ぎできない）`,
        });
      run = [];
      seconds = 0;
    };
    for (const n of ns) {
      if (n.heads.length === 0) breath();
      else {
        run.push(n);
        seconds += toNumber(n.duration) * spw[n.measure];
      }
    }
    breath();

    // 跳躍：1オクターブを超える跳躍が続く
    let leaps: Note[] = [];
    let prev: Note | undefined;
    const leap = () => {
      if (leaps.length - 1 >= t.leapRepeat)
        warnings.push({
          kind: 'leap',
          partId: part.id,
          ...span(leaps),
          message: `大きな跳躍が${leaps.length - 1}回続く`,
        });
      leaps = [];
    };
    for (const n of ns) {
      if (n.heads.length === 0) continue;
      if (prev && Math.abs(pitchOf(n) - pitchOf(prev)) > t.leapSemitones) {
        if (!leaps.length) leaps.push(prev);
        leaps.push(n);
      } else leap();
      prev = n;
    }
    leap();

    // 音域の端に長くとどまる
    let edge: Note[] = [];
    let beats = 0;
    const edgeFlush = () => {
      if (edge.length && beats >= t.edgeBeats)
        warnings.push({ kind: 'edge', partId: part.id, ...span(edge), message: '音域の端に長くとどまる' });
      edge = [];
      beats = 0;
    };
    for (const n of ns) {
      const m = n.heads.length ? pitchOf(n) : NaN;
      const near = m >= hi - t.edgeTopSemitones && m <= hi ? true : m <= lo + t.edgeBottomSemitones && m >= lo;
      if (near) {
        edge.push(n);
        beats += toNumber(n.duration) * 4;
      } else edgeFlush();
    }
    edgeFlush();

    // ホルンの高音が続く
    if (def.id.startsWith('horn')) {
      let high: Note[] = [];
      const flush = () => {
        if (high.length) {
          const first = high[0];
          const last = high[high.length - 1];
          const from = offsets[first.measure] + toNumber(first.onset);
          const to = offsets[last.measure] + toNumber(last.onset) + toNumber(last.duration);
          const measureLen = toNumber(index.lengthAt[first.measure]);
          if (to - from >= measureLen * t.hornHighMeasures)
            warnings.push({
              kind: 'horn-high',
              partId: part.id,
              ...span(high),
              message: 'ホルンの高音（E5以上）が続く',
            });
        }
        high = [];
      };
      for (const n of ns) {
        if (n.heads.length && pitchOf(n) >= t.hornHighMidi) high.push(n);
        else flush();
      }
      flush();
    }
  }

  // 旋律の欠け：旋律パートの音のうち、どの楽器にも使われなかった割合
  if (opts.source && opts.arrangement) {
    const used = new Set(score.notes.flatMap((n) => n.derivedFrom?.sourceNoteIds ?? []));
    for (const sec of opts.arrangement.sections) {
      const unit = Object.entries(sec.roles).find(([, r]) => r.startsWith('melody'))?.[0];
      if (!unit) continue;
      const [partId, staff] = unit.split('#');
      const melody = opts.source.notes.filter(
        (n) =>
          n.partId === partId &&
          n.staff === (staff ? Number(staff) : 1) &&
          n.measure >= sec.start &&
          n.measure < sec.end &&
          n.heads.length > 0 &&
          !n.grace,
      );
      const missing = melody.filter((n) => !used.has(n.id));
      if (melody.length && missing.length / melody.length > t.melodyMissingRatio)
        warnings.push({
          kind: 'melody-missing',
          partId,
          start: sec.start,
          end: sec.end,
          noteIds: missing.map((n) => n.id),
          message: `旋律の音の${Math.round((missing.length / melody.length) * 100)}%がどの楽器にもない`,
        });
    }
  }
  return warnings.sort((a, b) => a.start - b.start);
}
