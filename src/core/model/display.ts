// 表示・書き出し用の変換：実音 ⇔ 記譜音、臨時記号を付けるかどうか。

import { cmp, isZero } from '../theory/fraction';
import { AlterOverflowError, invert, transposePitch, type Interval } from '../theory/interval';
import { chooseKey, keyAlterations, respellInterval, transposeKey, type Key, type KeyFlavor } from '../theory/key';
import { simplifyEnharmonic, type Alter, type Pitch } from '../theory/pitch';
import type { Note, Transposition } from './types';

export type PitchMode = 'concert' | 'written';

/** 音程どおりに綴る。変化記号が ±2 を超えるときは異名同音にする */
export function spellWith(p: Pitch, iv: Interval | null): Pitch {
  if (!iv) return p;
  try {
    return transposePitch(p, iv);
  } catch (e) {
    if (e instanceof AlterOverflowError) return simplifyEnharmonic(transposePitch(simplifyEnharmonic(p), iv));
    throw e;
  }
}

/** 実音 → 記譜音（移調楽器でなければそのまま。調号の書き換えは考えない） */
export function writtenPitch(p: Pitch, t: Transposition | null): Pitch {
  return spellWith(p, t ? invert(t) : null);
}

/**
 * 移調楽器の記譜：その区間の実音の調から、記譜の調号と「実音 → 記譜音」の音程を決める。
 * 調号は flavor（パートごとの設定。既定は記号の少ない方、同数なら♯系）で選び、音の綴りもそれに合わせる。
 */
export function writtenSpelling(
  concert: Key,
  t: Transposition | null,
  flavor: KeyFlavor = 'auto',
): { key: Key; interval: Interval | null } {
  if (!t) return { key: concert, interval: null };
  const toWritten = invert(t);
  const raw = transposeKey(concert, toWritten);
  const key = chooseKey(raw, flavor);
  return { key, interval: respellInterval(toWritten, raw.fifths, key.fifths) };
}

/** 実音の調 → 記譜の調 */
export function writtenKey(concert: Key, t: Transposition | null, flavor: KeyFlavor = 'auto'): Key {
  return writtenSpelling(concert, t, flavor).key;
}

/**
 * 小節内で臨時記号を付ける音を決める（調号と、同じ小節で前に出た臨時記号を考える）。
 * 返り値：音（NoteHead.id）→ 付ける変化記号（付けないなら null）。pitchOf で表示する音高を渡す。
 */
export function planAccidentals(
  measureNotes: Note[],
  keyFifths: number,
  pitchOf: (p: Pitch) => Pitch,
): Map<string, Alter | null> {
  const result = new Map<string, Alter | null>();
  const keyAlt = keyAlterations(keyFifths);
  const byStaff = new Map<number, Note[]>();
  for (const n of measureNotes) {
    let arr = byStaff.get(n.staff);
    if (!arr) byStaff.set(n.staff, (arr = []));
    arr.push(n);
  }
  for (const staffNotes of byStaff.values()) {
    const sorted = staffNotes.slice().sort((a, b) => cmp(a.onset, b.onset) || Number(!a.grace) - Number(!b.grace));
    const state = new Map<string, number>(); // 'C4' → 有効な変化
    for (const n of sorted) {
      for (const h of n.heads) {
        if (h.unpitched) continue;
        const w = pitchOf(h.pitch);
        const slot = `${w.step}${w.octave}`;
        const current = state.get(slot) ?? keyAlt[w.step];
        let need = w.alter !== current;
        // 前の小節からタイでつながった音には付けない
        if (h.tie?.stop && !state.has(slot) && isZero(n.onset)) need = false;
        state.set(slot, w.alter);
        if (h.accidentalShown === 'courtesy' || h.accidentalShown === 'paren') need = true;
        result.set(h.id, need ? w.alter : null);
      }
    }
  }
  return result;
}
