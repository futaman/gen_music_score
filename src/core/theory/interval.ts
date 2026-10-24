// 音程。半音数だけでなく度数（音名をいくつ進めるか）を持つので、A♯ と B♭ を書き分けられる。

import { diatonicIndex, midi, spellFromDiatonic, type Pitch } from './pitch';

/** diatonic：音名をいくつ進めるか（長2度 = 1）、chromatic：半音数（長2度 = 2）。どちらも上向きが正 */
export type Interval = { diatonic: number; chromatic: number };

export type Quality = 'P' | 'M' | 'm' | 'A' | 'd' | 'AA' | 'dd';
export type Direction = 'up' | 'down';

// 1〜7度の「完全／長」の半音数
const BASE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const PERFECT = new Set([0, 3, 4]); // 1度・4度・5度（0始まり）

/** 'M2' 'P5' 'm3' 'A4' 'd5' 'P8' 'M9' を読む。上向きの音程を返す */
export function parseInterval(text: string): Interval {
  const m = /^(AA|dd|P|M|m|A|d)(\d+)$/.exec(text.trim());
  if (!m) throw new Error(`音程として読めません: ${text}`);
  const quality = m[1] as Quality;
  const number = Number(m[2]);
  if (number < 1) throw new Error(`度数は1以上: ${text}`);
  const diatonic = number - 1;
  const simple = diatonic % 7;
  const octaves = Math.floor(diatonic / 7);
  const base = BASE_SEMITONES[simple] + octaves * 12;
  let offset: number;
  if (PERFECT.has(simple)) {
    offset = { P: 0, A: 1, AA: 2, d: -1, dd: -2 }[quality as 'P'];
    if (offset === undefined) throw new Error(`${number}度に ${quality} は使えません`);
  } else {
    offset = { M: 0, m: -1, A: 1, AA: 2, d: -2, dd: -3 }[quality as 'M'];
    if (offset === undefined) throw new Error(`${number}度に ${quality} は使えません`);
  }
  return { diatonic, chromatic: base + offset };
}

/** 上向きの音程を 'M2' のような文字列にする */
export function formatInterval(iv: Interval): string {
  const d = Math.abs(iv.diatonic);
  const c = Math.abs(iv.chromatic) * Math.sign(iv.diatonic || iv.chromatic || 1);
  const simple = d % 7;
  const base = BASE_SEMITONES[simple] + Math.floor(d / 7) * 12;
  const off = c - base;
  const q = PERFECT.has(simple)
    ? ({ 0: 'P', 1: 'A', 2: 'AA', [-1]: 'd', [-2]: 'dd' } as Record<number, string>)[off]
    : ({ 0: 'M', [-1]: 'm', 1: 'A', 2: 'AA', [-2]: 'd', [-3]: 'dd' } as Record<number, string>)[off];
  return `${q ?? '?'}${d + 1}`;
}

export function withDirection(iv: Interval, dir: Direction): Interval {
  return dir === 'up' ? iv : invert(iv);
}

export function invert(iv: Interval): Interval {
  return { diatonic: -iv.diatonic, chromatic: -iv.chromatic };
}

export function addIntervals(a: Interval, b: Interval): Interval {
  return { diatonic: a.diatonic + b.diatonic, chromatic: a.chromatic + b.chromatic };
}

export function octaves(n: number): Interval {
  return { diatonic: 7 * n, chromatic: 12 * n };
}

/** 2音の間の音程（b − a） */
export function intervalBetween(a: Pitch, b: Pitch): Interval {
  return { diatonic: diatonicIndex(b) - diatonicIndex(a), chromatic: midi(b) - midi(a) };
}

export class AlterOverflowError extends Error {
  constructor(
    readonly from: Pitch,
    readonly interval: Interval,
  ) {
    super(`移調すると変化記号が ±2 を超えます`);
  }
}

/** 度数どおりに移調する。変化記号が ±2 を超える場合は AlterOverflowError */
export function transposePitch(p: Pitch, iv: Interval): Pitch {
  const result = spellFromDiatonic(diatonicIndex(p) + iv.diatonic, midi(p) + iv.chromatic);
  if (!result) throw new AlterOverflowError(p, iv);
  return result;
}
