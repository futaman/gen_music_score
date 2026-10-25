// 編曲の割当案：区間ごとに、役割から編成の楽器へ元のパート（段）を割り当てる。純粋な関数だけ。
// 仕様：docs/spec.md「割当の初期ルール」「編曲の判定基準」

import { ENSEMBLES, getInstrument, type Ensemble } from '../instruments';
import { buildScoreIndex, type ScoreIndex } from '../model/scoreIndex';
import type { Arrangement, Role, Score } from '../model/types';
import { midi } from '../theory/pitch';
import {
  analyzeSection,
  estimateRoles,
  measureOffsets,
  sectionStarts,
  sourceUnits,
  THRESHOLDS,
  type ArrangeThresholds,
  type SectionAnalysis,
  type UnitStats,
} from './analyze';

export type Section = Arrangement['sections'][number];

export type PlanOptions = {
  /** 同じ楽器に旋律が続きすぎないよう、区間ごとに旋律担当を回す */
  rotateMelody?: boolean;
  /** 区間の頭（指定がなければ自動で区切る） */
  starts?: number[];
  thresholds?: ArrangeThresholds;
};

export type ArrangementPlan = { arrangement: Arrangement; analyses: SectionAnalysis[] };

const center = (instrumentId: string) => {
  const [lo, hi] = getInstrument(instrumentId).range.practical;
  return (midi(lo) + midi(hi)) / 2;
};

/** 役割の優先順（先に決めたものが楽器を取る） */
const ORDER: Role[] = ['melody-high', 'melody-mid', 'bass', 'counter', 'harmony', 'double'];

/**
 * 1区間の割当。melodyHistory は前の区間までに旋律を受け持った楽器（新しい順）。
 * 戻り値の mapping は「楽器 → 元の単位」。余った楽器は、音域の近い単位を重ねて受け持つ（なければ休み）
 */
export function assignSection(
  ensemble: Ensemble,
  roles: Record<string, Role>,
  stats: UnitStats[],
  melodyHistory: string[],
  opts: { rotateMelody: boolean; rotateAfter: number },
): Record<string, string[]> {
  const mapping: Record<string, string[]> = Object.fromEntries(ensemble.instruments.map((i) => [i, []]));
  const free = new Set(ensemble.instruments);
  const statOf = new Map(stats.map((s) => [s.unitId, s]));
  const units = Object.entries(roles)
    .filter(([, r]) => r !== 'rest')
    .sort(([a, ra], [b, rb]) => {
      const d = ORDER.indexOf(ra) - ORDER.indexOf(rb);
      if (d !== 0) return d;
      // 同じ役割なら、対旋律は音の多い順、和声は高い順
      const sa = statOf.get(a)!;
      const sb = statOf.get(b)!;
      return ra === 'counter' ? sb.noteCount - sa.noteCount : sb.avgPitch - sa.avgPitch;
    });

  const closestFree = (pitch: number) =>
    [...free].sort((a, b) => Math.abs(center(a) - pitch) - Math.abs(center(b) - pitch))[0];

  for (const [unitId, role] of units) {
    if (role === 'double') continue; // 重複は、楽器が余ったときだけ受け持つ
    let candidates = ensemble.roles[role] ?? [];
    if (role.startsWith('melody') && opts.rotateMelody && candidates.length > 1) {
      const recent = melodyHistory.slice(0, opts.rotateAfter);
      if (recent.length === opts.rotateAfter && recent.every((i) => i === candidates[0]))
        candidates = [candidates[1], candidates[0], ...candidates.slice(2)];
    }
    const pick = candidates.find((c) => free.has(c)) ?? closestFree(statOf.get(unitId)!.avgPitch);
    if (!pick) continue;
    mapping[pick].push(unitId);
    free.delete(pick);
  }

  // 余った楽器：音域の近い単位（バスと休み以外）を重ねる
  const doublable = units.filter(([, r]) => r !== 'bass').map(([u]) => statOf.get(u)!);
  for (const inst of free) {
    const c = center(inst);
    const best = doublable
      .filter((s) => !Number.isNaN(s.avgPitch))
      .sort((a, b) => Math.abs(a.avgPitch - c) - Math.abs(b.avgPitch - c))[0];
    if (best) mapping[inst].push(best.unitId);
  }
  return mapping;
}

/** 楽譜全体の割当案を作る */
export function planArrangement(
  score: Score,
  ensembleId: string,
  opts: PlanOptions = {},
  index: ScoreIndex = buildScoreIndex(score),
): ArrangementPlan {
  const ensemble = ENSEMBLES.find((e) => e.id === ensembleId);
  if (!ensemble) throw new Error(`編成 ${ensembleId} がありません`);
  const t = opts.thresholds ?? THRESHOLDS;
  const units = sourceUnits(index);
  const offsets = measureOffsets(index);
  const starts = opts.starts ?? sectionStarts(index, units, t);
  const melodyHistory: string[] = [];
  const sections: Section[] = [];
  const analyses: SectionAnalysis[] = [];
  starts.forEach((start, i) => {
    const end = starts[i + 1] ?? score.measures.length;
    const analysis = analyzeSection(index, units, start, end, offsets);
    const roles = estimateRoles(analysis.stats, t);
    const mapping = assignSection(ensemble, roles, analysis.stats, melodyHistory, {
      rotateMelody: opts.rotateMelody ?? true,
      rotateAfter: t.rotateMelodyAfter,
    });
    const melodyUnit = Object.entries(roles).find(([, r]) => r.startsWith('melody'))?.[0];
    const melodyInst = ensemble.instruments.find((inst) => melodyUnit && mapping[inst][0] === melodyUnit);
    if (melodyInst) melodyHistory.unshift(melodyInst);
    sections.push({ id: `sec${i + 1}`, start, end, roles, mapping });
    analyses.push(analysis);
  });
  return {
    arrangement: { id: crypto.randomUUID(), sourceScoreId: score.id, targetScoreId: '', ensembleId, sections },
    analyses,
  };
}
