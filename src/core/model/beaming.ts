// 連桁（旗をつなぐ線）の自動決定。ファイルに連桁の情報がないとき、拍ごとに8分音符以下をつなぐ。

import { add, cmp, div, frac, lt, type Fraction } from '../theory/fraction';
import { NOTE_TYPE_VALUES, notationFor, tupletRatio } from './notation';
import type { Note } from './types';

/** 連桁をまとめる単位（4/4 なら4分音符、6/8 なら付点4分音符、3/8 なら1小節） */
export function beamUnit(time: { beats: number; beatType: number }): Fraction {
  if (time.beatType === 8 && time.beats === 3) return frac(3, 8);
  if (time.beatType >= 8 && time.beats % 3 === 0) return frac(3, time.beatType);
  if (time.beatType <= 2) return frac(1, 4);
  return frac(1, time.beatType);
}

const isBeamable = (n: Note) => {
  if (n.grace || n.heads.length === 0) return false;
  const type = n.notation?.type ?? notationFor(n.duration, tupletRatio(n))?.type;
  return !!type && lt(NOTE_TYPE_VALUES[type], frac(1, 4));
};

/** 1つの声部の音符（onset 順）を、連桁でつなぐまとまりに分ける（2音以上のまとまりだけ返す） */
export function autoBeamGroups(notes: Note[], time: { beats: number; beatType: number }): Note[][] {
  const unit = beamUnit(time);
  const bucketOf = (pos: Fraction) => Math.floor(pos.num / pos.den / (unit.num / unit.den) + 1e-9);
  const groups: Note[][] = [];
  let current: Note[] = [];
  let bucket = -1;
  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };
  for (const n of notes) {
    if (n.grace) continue;
    if (!isBeamable(n)) {
      flush();
      continue;
    }
    const b = bucketOf(n.onset);
    const end = add(n.onset, n.duration);
    // 拍の区切りをまたぐ音はつながない
    const crosses = cmp(div(end, unit), frac(b + 1)) > 0;
    if (b !== bucket || crosses) flush();
    bucket = b;
    if (crosses) continue;
    current.push(n);
  }
  flush();
  return groups;
}
