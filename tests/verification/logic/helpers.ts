// 検証用の小さな道具。期待値を製品コードの関数で作らないように、音高の計算はここで独立に持つ。

import { readFileSync, readdirSync } from 'node:fs';
import { readScoreFile } from '../../../src/core/musicxml/file';
import type { MeasureMeta, Note, Part, Score } from '../../../src/core/model/types';
import { frac } from '../../../src/core/theory/fraction';
import type { Pitch, Step } from '../../../src/core/theory/pitch';

const ASSETS = new URL('../../../test-assets/musicxml/', import.meta.url);

export const assetNames = () => readdirSync(ASSETS).filter((f) => /\.(mxl|musicxml|xml)$/.test(f));
export const assetBytes = (name: string) => new Uint8Array(readFileSync(new URL(name, ASSETS)));
export const loadAsset = (name: string) => readScoreFile(assetBytes(name), name).score;

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMI = [0, 2, 4, 5, 7, 9, 11];

/** 独立に計算した MIDI 番号 */
export const midiOf = (p: Pitch) => 12 * (p.octave + 1) + SEMI[STEPS.indexOf(p.step)] + p.alter;
/** 独立に計算した「音名の通し番号」（C4 = 28） */
export const diatonicOf = (p: Pitch) => 7 * p.octave + STEPS.indexOf(p.step);

export const P = (text: string): Pitch => {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(text)!;
  const acc = m[2] ?? '';
  const alter = !acc ? 0 : acc.startsWith('#') ? acc.length : -acc.length;
  return { step: m[1] as Step, alter: alter as Pitch['alter'], octave: Number(m[3]) };
};

/**
 * 小さな楽譜を作る。parts：パートID → { 楽器, 小節ごとの音 }。
 * 音は 'C5:4'（4分音符）、'C5+E5:2'（2分の和音）、'-:4'（4分休符）。末尾に '.' でスタッカート、'!' でフェルマータ
 */
export function buildScore(
  parts: Record<string, { instrument: string; measures: string[]; staves?: number }>,
  meta: Partial<MeasureMeta>[] = [],
  time = { beats: 4, beatType: 4 },
): Score {
  const notes: Note[] = [];
  let k = 0;
  const count = Math.max(...Object.values(parts).map((p) => p.measures.length));
  for (const [pid, p] of Object.entries(parts)) {
    p.measures.forEach((m, mi) => {
      let pos = 0;
      for (let tok of m.split(' ').filter(Boolean)) {
        const articulations: string[] = [];
        if (tok.endsWith('.')) {
          articulations.push('staccato');
          tok = tok.slice(0, -1);
        }
        if (tok.endsWith('!')) {
          articulations.push('fermata');
          tok = tok.slice(0, -1);
        }
        const [pitches, den] = tok.split(':');
        const len = 16 / Number(den);
        notes.push({
          id: `${pid}n${k++}`,
          partId: pid,
          measure: mi,
          staff: 1,
          voice: 1,
          onset: frac(pos, 16),
          duration: frac(len, 16),
          heads: pitches === '-' ? [] : pitches.split('+').map((t, i) => ({ id: `${pid}h${k}_${i}`, pitch: P(t) })),
          articulations,
          origin: 'source',
        });
        pos += len;
      }
    });
  }
  return {
    schemaVersion: 1,
    id: 'verify',
    title: 'verify',
    composer: '',
    parts: Object.entries(parts).map(([id, p]): Part => ({
      id,
      name: id,
      instrumentId: p.instrument,
      staves: p.staves ?? 1,
    })),
    measures: Array.from({ length: count }, (_, i) => ({
      index: i,
      displayNumber: String(i + 1),
      ...(i === 0 ? { key: { fifths: 0, mode: 'major' as const }, time } : {}),
      ...meta[i],
    })),
    notes,
    directions: [],
    clefs: [],
  };
}

/** 楽譜の音高を「音ID → 音高」にする */
export const pitchMap = (s: Score) => new Map(s.notes.flatMap((n) => n.heads.map((h) => [h.id, h.pitch] as const)));

/** 小節・声部ごとの長さの合計（16分音符単位） */
export function voiceLengths(s: Score, partId: string, measure: number): number[] {
  const sums = new Map<number, number>();
  for (const n of s.notes)
    if (n.partId === partId && n.measure === measure && !n.grace)
      sums.set(n.voice, (sums.get(n.voice) ?? 0) + (n.duration.num / n.duration.den) * 16);
  return [...sums.values()];
}
