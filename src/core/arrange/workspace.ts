// 編曲の作業：編曲案を作る、割当表を変えた楽器だけ作り直す（手直しした小節は残す）。純粋な関数だけ。
// 仕様：docs/spec.md「処理の流れ」5、docs/dev-plan.md 6c

import { ENSEMBLES } from '../instruments';
import type { EditResult } from '../edit/commands';
import { buildScoreIndex } from '../model/scoreIndex';
import type { Arrangement, Note, Score } from '../model/types';
import { fixTies } from '../transpose/transpose';
import { planArrangement, type PlanOptions } from './assign';
import { buildArrangedScore } from './build';

/** 編曲案（割当表）と、それから作った編成の楽譜 */
export function createArrangement(source: Score, ensembleId: string, opts: PlanOptions = {}) {
  const index = buildScoreIndex(source);
  const { arrangement } = planArrangement(source, ensembleId, opts, index);
  const score = buildArrangedScore(source, arrangement, index);
  return { arrangement: { ...arrangement, targetScoreId: score.id }, score };
}

export function ensembleName(arrangement: Arrangement): string {
  return ENSEMBLES.find((e) => e.id === arrangement.ensembleId)?.name ?? arrangement.ensembleId;
}

/** 手で直した音（生成したままでない音）があるか */
const touched = (n: Note) => n.origin !== 'generated';

/**
 * 区間 sectionId の楽器 instrument の割当を unitIds に変えて、その楽器の音を作り直す。
 * 手で直した音がある小節はそのまま残す。instrument を省くと区間の全楽器を作り直す
 */
export function reassign(
  source: Score,
  arrangement: Arrangement,
  current: Score,
  sectionId: string,
  instrument?: string,
  unitIds?: string[],
): { arrangement: Arrangement; result: EditResult; kept: number } {
  const sec = arrangement.sections.find((s) => s.id === sectionId);
  if (!sec) throw new Error(`区間 ${sectionId} がありません`);
  const newSec = instrument && unitIds ? { ...sec, mapping: { ...sec.mapping, [instrument]: unitIds } } : sec;
  const next: Arrangement = {
    ...arrangement,
    sections: arrangement.sections.map((s) => (s.id === sectionId ? newSec : s)),
  };
  const rebuilt = buildArrangedScore(source, { ...arrangement, sections: [newSec] });
  const targets = instrument ? [instrument] : current.parts.map((p) => p.id);

  // 作り直す小節（楽器ごと）：手で直した音がない小節
  const redo = new Set<string>();
  let kept = 0;
  for (const inst of targets) {
    for (let mi = sec.start; mi < sec.end; mi++) {
      const own = current.notes.filter((n) => n.partId === inst && n.measure === mi);
      if (own.some(touched)) kept++;
      else redo.add(`${inst}|${mi}`);
    }
  }
  const inRedo = (x: { partId: string; measure: number }) => redo.has(`${x.partId}|${x.measure}`);
  let notes = [...current.notes.filter((n) => !inRedo(n)), ...rebuilt.notes.filter(inRedo)];
  // 作り直した小節の前後でタイがつながらなくなったら外す
  for (const inst of targets) {
    const own = notes.filter((n) => n.partId === inst).map((n) => ({ ...n, heads: n.heads.map((h) => ({ ...h })) }));
    fixTies(own);
    notes = [...notes.filter((n) => n.partId !== inst), ...own];
  }
  const directions = [...current.directions.filter((d) => !inRedo(d)), ...rebuilt.directions.filter(inRedo)];
  const changed = [...new Set([...redo].map((k) => Number(k.split('|')[1])))].sort((a, b) => a - b);
  return {
    arrangement: next,
    result: {
      score: { ...current, notes, directions },
      changed,
      message: kept ? `手直しした${kept}小節はそのまま残しました` : undefined,
    },
    kept,
  };
}
