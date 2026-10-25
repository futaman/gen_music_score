import { describe, expect, it } from 'vitest';
import { frac, type Fraction } from '../theory/fraction';
import { autoBeamGroups, beamUnit } from './beaming';
import type { Note } from './types';

let id = 0;
const note = (onset: Fraction, duration: Fraction, rest = false): Note => ({
  id: `n${id++}`,
  partId: 'P1',
  measure: 0,
  staff: 1,
  voice: 1,
  onset,
  duration,
  heads: rest ? [] : [{ id: `h${id}`, pitch: { step: 'C', alter: 0, octave: 5 } }],
  articulations: [],
  origin: 'source',
});
/** 長さの列（分数の分母）から、続けて並べた音符を作る */
const seq = (dens: number[], rests: number[] = []) => {
  let pos = frac(0);
  return dens.map((d, i) => {
    const n = note(pos, frac(1, d), rests.includes(i));
    pos = frac(pos.num * d + pos.den, pos.den * d);
    return n;
  });
};
const sizes = (groups: Note[][]) => groups.map((g) => g.length);

describe('連桁の自動決定', () => {
  it('まとめる単位', () => {
    expect(beamUnit({ beats: 4, beatType: 4 })).toEqual(frac(1, 4));
    expect(beamUnit({ beats: 6, beatType: 8 })).toEqual(frac(3, 8));
    expect(beamUnit({ beats: 3, beatType: 8 })).toEqual(frac(3, 8));
    expect(beamUnit({ beats: 2, beatType: 2 })).toEqual(frac(1, 4));
  });
  it('4/4 の8分音符は1拍（2つ）ずつ', () => {
    expect(sizes(autoBeamGroups(seq([8, 8, 8, 8, 4, 4]), { beats: 4, beatType: 4 }))).toEqual([2, 2]);
  });
  it('16分音符は1拍（4つ）ずつ、休符で切れる', () => {
    expect(sizes(autoBeamGroups(seq([16, 16, 16, 16, 16, 16, 16, 16], [5]), { beats: 2, beatType: 4 }))).toEqual([
      4, 2,
    ]);
  });
  it('6/8 は付点4分（3つ）ずつ', () => {
    expect(sizes(autoBeamGroups(seq([8, 8, 8, 8, 8, 8]), { beats: 6, beatType: 8 }))).toEqual([3, 3]);
  });
  it('拍の区切りをまたぐ音（裏拍から始まる4分音符）はつながない', () => {
    expect(sizes(autoBeamGroups(seq([8, 4, 8]), { beats: 2, beatType: 4 }))).toEqual([]);
  });
});
