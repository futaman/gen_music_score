// 同じ曲の MIDI から読んだ楽譜と MusicXML から読んだ楽譜の一致率（音の始まり・高さ・長さ）。繰り返しは展開して比べる。

import { buildScoreIndex } from '../model/scoreIndex';
import type { Score } from '../model/types';
import { playOrder } from '../playback/timeline';
import { toNumber } from '../theory/fraction';
import { midi } from '../theory/pitch';

/** パートごとに「演奏順の時刻（全音符単位）|音の高さ → 長さ」。タイでつながった音は1つにする */
function events(score: Score, expand: boolean): Map<string, number>[] {
  const index = buildScoreIndex(score);
  const order = expand ? playOrder(score.measures) : score.measures.map((_, i) => i);
  const starts: number[] = [];
  let t = 0;
  // 小節の実際の長さ（弱起や繰り返しで分かれた短い小節があるので、拍子でなく音の終わりから）
  const actual = score.measures.map((_, mi) => {
    let end = 0;
    for (const p of score.parts)
      for (const n of index.notes.get(p.id)?.[mi] ?? [])
        if (!n.grace) end = Math.max(end, toNumber(n.onset) + toNumber(n.duration));
    return end || toNumber(index.lengthAt[mi]);
  });
  for (const mi of order) {
    starts.push(t);
    t += actual[mi];
  }
  return score.parts.map((p) => {
    const out = new Map<string, number>();
    const open = new Map<number, string>(); // 高さ → タイが続いている音のキー
    order.forEach((mi, k) => {
      for (const n of index.notes.get(p.id)?.[mi] ?? []) {
        if (n.grace) continue;
        const at = starts[k] + toNumber(n.onset);
        for (const h of n.heads) {
          const m = midi(h.pitch);
          const cont = h.tie?.stop ? open.get(m) : undefined;
          const key = cont ?? `${Math.round(at * 48)}|${m}`;
          out.set(key, (out.get(key) ?? 0) + toNumber(n.duration));
          if (h.tie?.start) open.set(m, key);
          else open.delete(m);
        }
      }
    });
    return out;
  });
}

export type MatchRate = { notes: number; pitch: number; duration: number };

/** MusicXML 側（reference）の音のうち、MIDI 側に同じ時刻・高さの音がある割合と、そのうち長さも同じ割合 */
export function matchRate(fromMidi: Score, reference: Score): MatchRate {
  const a = events(fromMidi, false);
  const b = events(reference, true);
  let total = 0;
  let pitch = 0;
  let duration = 0;
  b.forEach((ref, i) => {
    const got = a[i] ?? new Map<string, number>();
    for (const [k, d] of ref) {
      total++;
      const g = got.get(k);
      if (g === undefined) continue;
      pitch++;
      if (Math.abs(g - d) < 1e-6) duration++;
    }
  });
  return { notes: total, pitch: total ? pitch / total : 0, duration: total ? duration / total : 0 };
}
