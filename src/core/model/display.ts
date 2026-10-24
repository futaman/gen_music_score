// 表示・書き出し用の変換：実音 ⇔ 記譜音、臨時記号を付けるかどうか。

import { cmp, isZero } from '../theory/fraction';
import { AlterOverflowError, invert, transposePitch } from '../theory/interval';
import { keyAlterations, normalizeKey, transposeKey, type Key } from '../theory/key';
import { simplifyEnharmonic, type Alter, type Pitch } from '../theory/pitch';
import type { Note, Transposition } from './types';

export type PitchMode = 'concert' | 'written';

/** 実音 → 記譜音（移調楽器でなければそのまま） */
export function writtenPitch(p: Pitch, t: Transposition | null): Pitch {
  if (!t) return p;
  try {
    return transposePitch(p, invert(t));
  } catch (e) {
    if (e instanceof AlterOverflowError) return simplifyEnharmonic(transposePitch(simplifyEnharmonic(p), invert(t)));
    throw e;
  }
}

/** 実音の調 → 記譜の調 */
export function writtenKey(concert: Key, t: Transposition | null): Key {
  return t ? normalizeKey(transposeKey(concert, invert(t))) : concert;
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
