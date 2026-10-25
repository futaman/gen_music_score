// 音符の種類（4分音符・付点など）と長さの対応。

import { add, div, eq, frac, mul, type Fraction } from '../theory/fraction';
import type { Note, NoteType } from './types';

export const NOTE_TYPE_VALUES: Record<NoteType, Fraction> = {
  maxima: frac(8),
  long: frac(4),
  breve: frac(2),
  whole: frac(1),
  half: frac(1, 2),
  quarter: frac(1, 4),
  eighth: frac(1, 8),
  '16th': frac(1, 16),
  '32nd': frac(1, 32),
  '64th': frac(1, 64),
  '128th': frac(1, 128),
  '256th': frac(1, 256),
  '512th': frac(1, 512),
  '1024th': frac(1, 1024),
};

export const NOTE_TYPES = Object.keys(NOTE_TYPE_VALUES) as NoteType[];

export function isNoteType(s: string): s is NoteType {
  return s in NOTE_TYPE_VALUES;
}

/** 付点を含めた見かけの長さ */
export function notatedValue(type: NoteType, dots: number): Fraction {
  let v = NOTE_TYPE_VALUES[type];
  let total = v;
  for (let i = 0; i < dots; i++) {
    v = mul(v, frac(1, 2));
    total = add(total, v);
  }
  return total;
}

/** 連符の比（実際の長さ / 見かけの長さ）。3連符なら 2/3 */
export function tupletRatio(note: Pick<Note, 'tuplets'>): Fraction {
  return (note.tuplets ?? []).reduce((r, t) => mul(r, frac(t.normal, t.actual)), frac(1));
}

/** 実際の長さと連符の比から、音符の種類と付点の数を求める。表せなければ null */
export function notationFor(duration: Fraction, ratio: Fraction = frac(1)): { type: NoteType; dots: number } | null {
  const shown = div(duration, ratio);
  for (const type of NOTE_TYPES) {
    for (let dots = 0; dots <= 3; dots++) {
      if (eq(notatedValue(type, dots), shown)) return { type, dots };
    }
  }
  return null;
}
