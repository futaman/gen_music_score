// 音域チェック：楽器の実用音域（config/instruments.json、実音）の外にある音を探し、オクターブ移動の候補を出す。

import { getInstrument } from '../instruments';
import type { Score } from '../model/types';
import { midi, type Pitch } from '../theory/pitch';

export type RangeIssue = {
  headId: string;
  noteId: string;
  partId: string;
  measure: number;
  pitch: Pitch;
  kind: 'high' | 'low';
  /** 音域に入るオクターブ移動（-1 なら1オクターブ下げる）。入らなければ null */
  suggestOctaves: number | null;
};

export function checkRanges(score: Score, partIds?: string[]): RangeIssue[] {
  const issues: RangeIssue[] = [];
  const ranges = new Map(
    score.parts
      .filter((p) => !partIds || partIds.includes(p.id))
      .map((p) => [p.id, getInstrument(p.instrumentId)] as const)
      .filter(([, def]) => !def.unpitched && def.id !== 'unknown')
      .map(([id, def]) => [id, [midi(def.range.practical[0]), midi(def.range.practical[1])] as const]),
  );
  for (const n of score.notes) {
    const r = ranges.get(n.partId);
    if (!r) continue;
    for (const h of n.heads) {
      const m = midi(h.pitch);
      if (m >= r[0] && m <= r[1]) continue;
      const kind = m > r[1] ? 'high' : 'low';
      let suggest: number | null = null;
      for (const o of kind === 'high' ? [-1, -2, -3] : [1, 2, 3]) {
        if (m + 12 * o >= r[0] && m + 12 * o <= r[1]) {
          suggest = o;
          break;
        }
      }
      issues.push({
        headId: h.id,
        noteId: n.id,
        partId: n.partId,
        measure: n.measure,
        pitch: h.pitch,
        kind,
        suggestOctaves: suggest,
      });
    }
  }
  return issues;
}
