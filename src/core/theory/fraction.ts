// 音価・位置を表す分数。4分音符 = 1/4。3連符などで誤差を出さないため小数は使わない。

export type Fraction = { num: number; den: number };

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

export function frac(num: number, den = 1): Fraction {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0) {
    throw new Error(`不正な分数: ${num}/${den}`);
  }
  if (den < 0) [num, den] = [-num, -den];
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export const ZERO: Fraction = { num: 0, den: 1 };

export const add = (a: Fraction, b: Fraction) => frac(a.num * b.den + b.num * a.den, a.den * b.den);
export const sub = (a: Fraction, b: Fraction) => frac(a.num * b.den - b.num * a.den, a.den * b.den);
export const mul = (a: Fraction, b: Fraction) => frac(a.num * b.num, a.den * b.den);
export const div = (a: Fraction, b: Fraction) => frac(a.num * b.den, a.den * b.num);
export const cmp = (a: Fraction, b: Fraction) => a.num * b.den - b.num * a.den;
export const eq = (a: Fraction, b: Fraction) => cmp(a, b) === 0;
export const lt = (a: Fraction, b: Fraction) => cmp(a, b) < 0;
export const isZero = (a: Fraction) => a.num === 0;
export const toNumber = (a: Fraction) => a.num / a.den;
export const max = (a: Fraction, b: Fraction) => (cmp(a, b) >= 0 ? a : b);
export const toString = (a: Fraction) => `${a.num}/${a.den}`;

/** MusicXML の duration（divisions = 4分音符あたりの数）を分数に変換する */
export function fromDivisions(duration: number, divisions: number): Fraction {
  if (Number.isInteger(duration) && Number.isInteger(divisions)) return frac(duration, divisions * 4);
  // 小数の duration を書くソフトもあるので、1/1000 単位に丸める
  return frac(Math.round(duration * 1000), Math.round(divisions * 4000));
}

/** 分数を MusicXML の duration に変換する。割り切れなければ null */
export function toDivisions(value: Fraction, divisions: number): number | null {
  const n = (value.num * divisions * 4) / value.den;
  return Number.isInteger(n) ? n : null;
}
