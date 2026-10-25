// 2つの楽譜の「音符情報」が同じかを比べる（往復テスト用）。
// 比べる項目は仕様書「テスト素材の入手元」の節を参照。表示位置・フォントは比べない。

import { partTransposition } from '../instruments';
import { tupletRatio } from '../model/notation';
import type { Note, Score } from '../model/types';
import { toString } from '../theory/fraction';
import { formatPitch } from '../theory/pitch';

function noteKey(n: Note, partIndex: number): string {
  const heads = n.heads
    .map((h) => `${formatPitch(h.pitch)}${h.tie?.start ? '~' : ''}${h.tie?.stop ? '^' : ''}`)
    .sort()
    .join(',');
  return [
    `p${partIndex}`,
    `m${n.measure}`,
    `s${n.staff}`,
    `v${n.voice}`,
    `@${toString(n.onset)}`,
    `d${toString(n.duration)}`,
    n.grace ? 'grace' : '',
    heads || 'rest',
    n.tuplets?.length ? `t${toString(tupletRatio(n))}` : '',
  ].join(' ');
}

/** 比較用に楽譜を行の配列にする */
export function canonicalLines(score: Score): string[] {
  const lines: string[] = [];
  lines.push(`parts ${score.parts.length}`);
  score.parts.forEach((p, i) => {
    const t = partTransposition(p);
    lines.push(`part ${i} ${p.instrumentId} staves=${p.staves} t=${t ? `${t.diatonic}/${t.chromatic}` : '-'}`);
  });
  lines.push(`measures ${score.measures.length}`);
  for (const m of score.measures) {
    const bits = [`m${m.index}`];
    if (m.time) bits.push(`time=${m.time.beats}/${m.time.beatType}`);
    if (m.key) bits.push(`key=${m.key.fifths}${m.key.mode[0]}`);
    if (m.repeat) bits.push(`repeat=${m.repeat}`);
    if (m.ending) bits.push(`ending=${m.ending.numbers}:${m.ending.type}`);
    if (bits.length > 1) lines.push(bits.join(' '));
  }
  const partIndex = new Map(score.parts.map((p, i) => [p.id, i]));
  for (const c of score.clefs) {
    lines.push(
      `clef p${partIndex.get(c.partId)} m${c.measure} s${c.staff} @${toString(c.onset)} ${c.sign}${c.line}${c.octaveChange ?? ''}`,
    );
  }
  const notes = score.notes.map((n) => noteKey(n, partIndex.get(n.partId) ?? -1));
  lines.push(...notes);
  return lines.sort();
}

export type ScoreDiff = { onlyInA: string[]; onlyInB: string[] };

export function diffScores(a: Score, b: Score): ScoreDiff {
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ca = count(canonicalLines(a));
  const cb = count(canonicalLines(b));
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  for (const [l, n] of ca) for (let i = 0; i < n - (cb.get(l) ?? 0); i++) onlyInA.push(l);
  for (const [l, n] of cb) for (let i = 0; i < n - (ca.get(l) ?? 0); i++) onlyInB.push(l);
  return { onlyInA: onlyInA.sort(), onlyInB: onlyInB.sort() };
}
