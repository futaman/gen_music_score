// 楽譜を描画・再生するための索引。小節ごとの音・記号の一覧と、各小節の頭で有効な拍子・調号・音部記号を持つ。
// 楽譜が変わったら作り直す（作り直しは数十ミリ秒）。

import { add, cmp, eq, frac, isZero, lt, type Fraction } from '../theory/fraction';
import { midi } from '../theory/pitch';
import type { ClefChange, Direction, MeasureMeta, Note, Score } from './types';

export type Time = NonNullable<MeasureMeta['time']>;
export type ConcertKey = NonNullable<MeasureMeta['key']>;

export type ScoreIndex = {
  score: Score;
  /** partId → 小節index → 音（onset順、装飾音は主音の前） */
  notes: Map<string, Note[][]>;
  /** partId → 小節index → 記号 */
  directions: Map<string, Direction[][]>;
  /** partId → 音部記号の変化（時間順） */
  clefs: Map<string, ClefChange[]>;
  timeAt: Time[];
  keyAt: ConcertKey[];
  /** 小節の長さ（拍子どおり。分割された小節も拍子の長さ） */
  lengthAt: Fraction[];
  /** タイの始まりの音（NoteHead.id）→ 終わりの音 */
  tieEnd: Map<string, { headId: string; measure: number }>;
  /** スラーの id → 始まり・終わりの音符 */
  slurs: Map<string, { start?: Note; stop?: Note }>;
  /** NoteHead.id → Note */
  noteOfHead: Map<string, Note>;
};

const byOnset = (a: Note, b: Note) => cmp(a.onset, b.onset) || Number(!a.grace) - Number(!b.grace);

export function buildScoreIndex(score: Score): ScoreIndex {
  const count = score.measures.length;
  const notes = new Map<string, Note[][]>();
  const directions = new Map<string, Direction[][]>();
  const clefs = new Map<string, ClefChange[]>();
  for (const p of score.parts) {
    notes.set(
      p.id,
      Array.from({ length: count }, () => []),
    );
    directions.set(
      p.id,
      Array.from({ length: count }, () => []),
    );
    clefs.set(p.id, []);
  }
  const noteOfHead = new Map<string, Note>();
  for (const n of score.notes) {
    notes.get(n.partId)?.[n.measure]?.push(n);
    for (const h of n.heads) noteOfHead.set(h.id, n);
  }
  for (const list of notes.values()) for (const m of list) m.sort(byOnset);
  for (const d of score.directions) directions.get(d.partId)?.[d.measure]?.push(d);
  for (const c of score.clefs) clefs.get(c.partId)?.push(c);
  for (const list of clefs.values())
    list.sort((a, b) => a.measure - b.measure || cmp(a.onset, b.onset) || a.staff - b.staff);

  const timeAt: Time[] = [];
  const keyAt: ConcertKey[] = [];
  const lengthAt: Fraction[] = [];
  let time: Time = { beats: 4, beatType: 4 };
  let key: ConcertKey = { fifths: 0, mode: 'major' };
  for (const m of score.measures) {
    if (m.time) time = m.time;
    if (m.key) key = m.key;
    timeAt.push(time);
    keyAt.push(key);
    lengthAt.push(frac(time.beats, time.beatType));
  }

  // タイ：同じパートで、終わった位置から始まる同じ高さの音（次の小節の頭も含む）
  const tieEnd = new Map<string, { headId: string; measure: number }>();
  for (const [, list] of notes) {
    list.forEach((mNotes, mi) => {
      for (const n of mNotes) {
        if (n.grace) continue;
        for (const h of n.heads) {
          if (!h.tie?.start) continue;
          const end = add(n.onset, n.duration);
          const candidates = [
            ...mNotes.filter((x) => eq(x.onset, end)).map((x) => ({ x, measure: mi })),
            ...(lt(end, lengthAt[mi])
              ? []
              : (list[mi + 1] ?? []).filter((x) => isZero(x.onset)).map((x) => ({ x, measure: mi + 1 }))),
          ];
          const pitch = midi(h.pitch);
          const sameVoice = candidates.sort((a, b) => Number(a.x.voice !== n.voice) - Number(b.x.voice !== n.voice));
          for (const c of sameVoice) {
            const target = c.x.heads.find((t) => t.tie?.stop && midi(t.pitch) === pitch);
            if (target) {
              tieEnd.set(h.id, { headId: target.id, measure: c.measure });
              break;
            }
          }
        }
      }
    });
  }

  const slurs = new Map<string, { start?: Note; stop?: Note }>();
  for (const n of score.notes) {
    for (const s of n.slurs ?? []) {
      let e = slurs.get(s.id);
      if (!e) slurs.set(s.id, (e = {}));
      e[s.type] = n;
    }
  }

  return { score, notes, directions, clefs, timeAt, keyAt, lengthAt, tieEnd, slurs, noteOfHead };
}

/** 小節 mi の位置 onset で有効な音部記号（その位置で変わるものを含む） */
export function clefAt(
  index: ScoreIndex,
  partId: string,
  staff: number,
  mi: number,
  onset: Fraction,
): ClefChange | undefined {
  let found: ClefChange | undefined;
  for (const c of index.clefs.get(partId) ?? []) {
    if (c.staff !== staff) continue;
    if (c.measure < mi || (c.measure === mi && cmp(c.onset, onset) <= 0)) found = c;
    else break;
  }
  return found;
}
