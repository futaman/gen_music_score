// 長さの分け方と、休符の作り方（移調・編集で共通に使う）。

import { add, cmp, frac, sub, type Fraction } from '../theory/fraction';
import type { Note } from './types';

let seq = 0;
/** 新しい id（同じ楽譜の中で重ならない） */
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 書き表せる長さ（付点なし・1つ付点）に分ける。長い方から */
export function splitDuration(d: Fraction): Fraction[] {
  const values = [1, 2, 4, 8, 16, 32, 64].flatMap((den) => [frac(3, den * 2), frac(1, den)]);
  const out: Fraction[] = [];
  let rest = d;
  for (const v of values) {
    while (cmp(rest, v) >= 0) {
      out.push(v);
      rest = sub(rest, v);
    }
  }
  return out;
}

type Place = Pick<Note, 'partId' | 'measure' | 'staff' | 'voice'>;

/** onset から duration の長さを休符で埋める */
export function makeRests(
  place: Place,
  onset: Fraction,
  duration: Fraction,
  origin: Note['origin'] = 'generated',
): Note[] {
  let pos = onset;
  return splitDuration(duration).map((d) => {
    const r: Note = {
      id: newId('r'),
      partId: place.partId,
      measure: place.measure,
      staff: place.staff,
      voice: place.voice,
      onset: pos,
      duration: d,
      heads: [],
      articulations: [],
      origin,
    };
    pos = add(pos, d);
    return r;
  });
}
