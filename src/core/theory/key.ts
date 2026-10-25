// 調号。fifths（♯の数、♭は負）で持つ。

import type { Interval } from './interval';
import { pitch, STEPS, type Alter, type Pitch, type Step } from './pitch';

export type Mode = 'major' | 'minor';
export type Key = { fifths: number; mode: Mode };

// ♯が付く順（F C G D A E B）。♭はその逆順
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
// fifths = 0 からの5度圏上の主音（長調）：C G D A E B F♯ ... / F B♭ ...
const MAJOR_TONIC_INDEX: Record<Step, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

/** 調号で変化する音名 → 変化量 */
export function keyAlterations(fifths: number): Record<Step, Alter> {
  const result = Object.fromEntries(STEPS.map((s) => [s, 0])) as Record<Step, Alter>;
  const n = Math.abs(fifths);
  for (let i = 0; i < n; i++) {
    const step = fifths > 0 ? SHARP_ORDER[i % 7] : SHARP_ORDER[6 - (i % 7)];
    const v = result[step] + (fifths > 0 ? 1 : -1);
    result[step] = v as Alter;
  }
  return result;
}

/** 主音（オクターブは無関係）の fifths。長調なら C=0, G=1, F=-1, B♭=-2 ... */
export function fifthsOfTonic(tonic: { step: Step; alter: number }, mode: Mode): number {
  const major = MAJOR_TONIC_INDEX[tonic.step] + tonic.alter * 7;
  return mode === 'major' ? major : major - 3;
}

/** 調の主音（オクターブ4で返す） */
export function tonicOf(key: Key): Pitch {
  const major = key.mode === 'major' ? key.fifths : key.fifths + 3;
  // fifths → 音名：C から完全5度ずつ進める
  const steps = ((major % 7) + 7) % 7;
  const step = (['C', 'G', 'D', 'A', 'E', 'B', 'F'] as Step[])[steps];
  const natural = MAJOR_TONIC_INDEX[step];
  const alter = (major - natural) / 7;
  return pitch(step, alter, 4);
}

/** 調を移調する（主音を度数どおりに動かして調号を求める） */
export function transposeKey(key: Key, iv: Interval): Key {
  // 五度圏の上で動かす：音程は「半音 × 7 − 度 × 12」だけ五度圏を進む（長2度 = +2、短2度 = −5、完全5度 = +1）。
  // 主音の綴りを経由しないので、♯♯・♭♭を超える調（C♭メジャーを増2度上げるなど）でも例外にならない。
  // ♯・♭が7つを超えた調はそのまま返す（異名同音の調への置き換えは呼び出し側）
  return { fifths: key.fifths + 7 * iv.chromatic - 12 * iv.diatonic, mode: key.mode };
}

/** ♯・♭が7つを超える調を異名同音の調にする（G♯メジャー → A♭メジャー） */
export function normalizeKey(key: Key): Key {
  let f = key.fifths;
  while (f > 7) f -= 12;
  while (f < -7) f += 12;
  return { ...key, fifths: f };
}

/**
 * 記号の少ない方の異名同音の調にする。同数（6つ）なら prefer に従う（既定は♯系）。
 * 例：♯6（F♯メジャー）と ♭6（G♭メジャー）
 */
export function simplestKey(key: Key, prefer: 'sharp' | 'flat' = 'sharp'): Key {
  const n = normalizeKey(key).fifths;
  const other = n > 0 ? n - 12 : n + 12;
  if (Math.abs(other) < Math.abs(n)) return { ...key, fifths: other };
  if (Math.abs(other) === Math.abs(n) && n !== 0) {
    return { ...key, fifths: prefer === 'sharp' ? Math.max(n, other) : Math.min(n, other) };
  }
  return { ...key, fifths: n };
}

export type KeyFlavor = 'auto' | 'sharp' | 'flat';

/**
 * 調号を♯系・♭系のどちらで書くか決める。
 * auto：記号の少ない方（同数なら♯系）。sharp / flat：その系統で書ける（7つ以内）ならそちら。
 */
export function chooseKey(key: Key, flavor: KeyFlavor): Key {
  const n = normalizeKey(key);
  if (flavor === 'auto') return simplestKey(n, 'sharp');
  const other = n.fifths > 0 ? n.fifths - 12 : n.fifths < 0 ? n.fifths + 12 : 0;
  const wantSharp = flavor === 'sharp';
  if (wantSharp && n.fifths < 0 && other <= 7) return { ...n, fifths: other };
  if (!wantSharp && n.fifths > 0 && other >= -7) return { ...n, fifths: other };
  return n;
}

/**
 * 調を異名同音に書き換えたとき（fifths が ±12 変わったとき）に、音の綴りも合わせるための音程の補正。
 * 例：G♭メジャー（-6）→ F♯メジャー（+6）は、音名を1つ下げる（G♭ → F♯）。
 */
export function respellInterval(iv: Interval, fromFifths: number, toFifths: number): Interval {
  return { diatonic: iv.diatonic - (toFifths - fromFifths) / 12, chromatic: iv.chromatic };
}
