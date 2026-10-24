// 再生用のイベント列を作る。繰り返し記号は楽譜には残し、ここで展開する（docs/spec.md「対応するMusicXML要素」）。
// 強弱は音量、スタッカートは音長50%、フェルマータは1.5倍（docs/spec.md「再生音源」）。

import { getInstrument } from '../instruments';
import type { ScoreIndex } from '../model/scoreIndex';
import type { MeasureMeta, Note } from '../model/types';
import { add, cmp, max, toNumber, ZERO, type Fraction } from '../theory/fraction';
import { midi } from '../theory/pitch';

export type PlayEvent = {
  time: number; // 秒
  duration: number; // 秒
  midi: number;
  velocity: number; // 0〜1
  partId: string;
  headId: string;
};

export type MeasureMark = { time: number; measure: number; duration: number };

export type Timeline = { events: PlayEvent[]; measures: MeasureMark[]; duration: number };

const DYNAMICS: Record<string, number> = {
  pppp: 0.2,
  ppp: 0.28,
  pp: 0.38,
  p: 0.48,
  mp: 0.58,
  mf: 0.68,
  f: 0.8,
  ff: 0.9,
  fff: 0.97,
  ffff: 1,
};
const ACCENT_DYNAMICS: Record<string, number> = {
  sf: 0.15,
  sfz: 0.18,
  sffz: 0.22,
  fz: 0.15,
  rf: 0.1,
  rfz: 0.12,
  fp: 0.15,
  sfp: 0.15,
};
const DEFAULT_QPM = 100;

/** 演奏する小節の順番（繰り返し・括弧・D.C./D.S.・Fine・Coda を展開） */
export function playOrder(measures: MeasureMeta[]): number[] {
  const n = measures.length;
  const order: number[] = [];
  const endingNumbers = (m: MeasureMeta) =>
    (m.ending?.numbers ?? '')
      .split(/[,\s]+/)
      .map(Number)
      .filter((x) => Number.isFinite(x) && x > 0);
  // 括弧の範囲（始まり → 終わり）
  const endingEnd = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (!measures[i].ending?.type.startsWith('start')) continue;
    let j = i;
    while (j < n) {
      const t = measures[j].ending?.type;
      if (t && t !== 'start') break; // stop・discontinue・start-stop など
      if (j > i && t === 'start') {
        j--; // 次の括弧が始まったら、その手前で終わり
        break;
      }
      j++;
    }
    endingEnd.set(i, Math.min(j, n - 1));
  }
  const isLastEnding = (i: number) => {
    const end = endingEnd.get(i)!;
    return !measures[end + 1]?.ending?.type.startsWith('start');
  };
  const segno = measures.findIndex((m) => m.jumps?.includes('segno'));

  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let afterJump = false;
  const repeatCount = new Map<number, number>();
  while (i < n && order.length < n * 10) {
    const m = measures[i];
    if ((m.repeat === 'start' || m.repeat === 'both') && !afterJump) {
      if (repeatStart !== i) pass = 1;
      repeatStart = i;
    }
    if (endingEnd.has(i)) {
      const nums = endingNumbers(m);
      const take = afterJump ? isLastEnding(i) : nums.length === 0 || nums.includes(pass);
      if (!take) {
        i = endingEnd.get(i)! + 1;
        continue;
      }
    }
    order.push(i);
    if (afterJump && m.jumps?.includes('fine')) break;
    if (afterJump && m.jumps?.includes('tocoda')) {
      const coda = measures.findIndex((x, k) => k > i && x.jumps?.includes('coda'));
      if (coda >= 0) {
        i = coda;
        continue;
      }
    }
    if ((m.repeat === 'end' || m.repeat === 'both') && !afterJump) {
      const count = repeatCount.get(i) ?? 1;
      if (count < (m.repeatTimes ?? 2)) {
        repeatCount.set(i, count + 1);
        pass = count + 1;
        i = repeatStart;
        continue;
      }
    }
    if (!afterJump && (m.jumps?.includes('dacapo') || m.jumps?.includes('dalsegno'))) {
      afterJump = true;
      i = m.jumps.includes('dalsegno') && segno >= 0 ? segno : 0;
      continue;
    }
    i++;
  }
  return order;
}

/** テンポ（4分音符/分）と、その位置 */
type TempoChange = { at: Fraction; qpm: number };

const toQpm = (bpm: number, beatUnit: Fraction) => (bpm * beatUnit.num * 4) / beatUnit.den;

export function buildTimeline(index: ScoreIndex, opts: { partIds?: string[] } = {}): Timeline {
  const { score } = index;
  const parts = score.parts.filter((p) => !opts.partIds || opts.partIds.includes(p.id));
  const order = playOrder(score.measures);

  // 小節ごとの長さ（弱起・分割された小節は中身の長さ）
  const contentEnd = score.measures.map(() => ZERO);
  for (const n of score.notes)
    if (!n.grace) contentEnd[n.measure] = max(contentEnd[n.measure], add(n.onset, n.duration));
  const lengthOf = (mi: number) => {
    const nominal = index.lengthAt[mi];
    const content = contentEnd[mi];
    if (score.measures[mi].implicit || (mi === 0 && cmp(content, nominal) < 0)) return content.num ? content : nominal;
    return cmp(content, nominal) > 0 ? content : nominal;
  };

  // 小節ごとのテンポ変化（小節頭のテンポ＋小節の途中のテンポ記号）とフェルマータの位置
  const tempos: TempoChange[][] = score.measures.map((m) =>
    m.tempo ? [{ at: ZERO, qpm: toQpm(m.tempo.bpm, m.tempo.beatUnit) }] : [],
  );
  for (const d of score.directions) {
    if (d.kind === 'tempo' && d.tempo)
      tempos[d.measure].push({ at: d.onset, qpm: toQpm(d.tempo.bpm, d.tempo.beatUnit) });
  }
  for (const t of tempos) t.sort((a, b) => cmp(a.at, b.at));
  const fermatas: { at: Fraction; length: Fraction }[][] = score.measures.map(() => []);
  for (const n of score.notes) {
    if (n.articulations.some((a) => a.startsWith('fermata'))) {
      fermatas[n.measure].push({ at: add(n.onset, n.duration), length: n.duration });
    }
  }

  const events: PlayEvent[] = [];
  const marks: MeasureMark[] = [];
  let time = 0;
  let qpm = DEFAULT_QPM;
  const dynamics = new Map<string, number>(parts.map((p) => [p.id, DYNAMICS.mf]));
  const tieTargets = new Set([...index.tieEnd.values()].map((v) => v.headId));

  for (const mi of order) {
    const length = lengthOf(mi);
    // この小節の中の「位置 → 秒」
    const changes = tempos[mi];
    const startQpm = qpm;
    const pauses = fermatas[mi].map((f) => ({ at: f.at, seconds: 0 }));
    // フェルマータの位置以降（その位置ちょうどを含む）は、止まった分だけ後ろにずれる
    const secAt = (pos: Fraction): number => {
      let s = 0;
      let cur = ZERO;
      let q = startQpm;
      for (const c of changes) {
        if (cmp(c.at, pos) >= 0) break;
        s += (toNumber(c.at) - toNumber(cur)) * (240 / q);
        cur = c.at;
        q = c.qpm;
      }
      s += (toNumber(pos) - toNumber(cur)) * (240 / q);
      for (const p of pauses) if (cmp(p.at, pos) <= 0) s += p.seconds;
      return s;
    };
    // フェルマータは、その音の長さの半分だけ止まる
    for (const [k, f] of fermatas[mi].entries()) pauses[k].seconds = 0.5 * (secAt(add(f.at, f.length)) - secAt(f.at));
    if (changes.length) qpm = changes[changes.length - 1].qpm;
    const measureSeconds = secAt(length);
    marks.push({ time, measure: mi, duration: measureSeconds });

    for (const part of parts) {
      if (getInstrument(part.instrumentId).unpitched) continue;
      const notes = index.notes.get(part.id)?.[mi] ?? [];
      // 強弱（小節内の位置順に反映）
      const dirs = (index.directions.get(part.id)?.[mi] ?? [])
        .filter((d) => d.kind === 'dynamic')
        .sort((a, b) => cmp(a.onset, b.onset));
      let di = 0;
      let accent = 0;
      const graces: Note[] = [];
      for (const n of notes) {
        while (di < dirs.length && cmp(dirs[di].onset, n.onset) <= 0) {
          const v = dirs[di].value;
          if (DYNAMICS[v] !== undefined) dynamics.set(part.id, DYNAMICS[v]);
          if (ACCENT_DYNAMICS[v] !== undefined) {
            accent = ACCENT_DYNAMICS[v];
            if (v === 'fp' || v === 'sfp') dynamics.set(part.id, DYNAMICS.p);
          }
          di++;
        }
        if (n.grace) {
          graces.push(n);
          continue;
        }
        const start = time + secAt(n.onset);
        const end = time + secAt(add(n.onset, n.duration));
        let velocity = Math.min(1, (dynamics.get(part.id) ?? 0.68) + accent);
        accent = 0;
        if (n.articulations.includes('accent') || n.articulations.includes('strong-accent'))
          velocity = Math.min(1, velocity + 0.12);
        const ratio = n.articulations.includes('staccatissimo')
          ? 0.3
          : n.articulations.includes('staccato') || n.articulations.includes('spiccato')
            ? 0.5
            : n.articulations.includes('tenuto')
              ? 1
              : 0.95;
        // 装飾音：主音の直前に短く
        graces.forEach((g, gi) => {
          for (const h of g.heads) {
            const len = 0.07;
            events.push({
              time: Math.max(0, start - (graces.length - gi) * len),
              duration: len,
              midi: midi(h.pitch),
              velocity: velocity * 0.9,
              partId: part.id,
              headId: h.id,
            });
          }
        });
        graces.length = 0;
        for (const h of n.heads) {
          if (h.tie?.stop && tieTargets.has(h.id)) continue;
          let dur = end - start;
          // タイでつながった音は1つの長い音にする（同じ順番で続く小節だけ）
          let cur = h.id;
          let curMi = mi;
          let extra = 0;
          for (let guard = 0; guard < 64; guard++) {
            const next = index.tieEnd.get(cur);
            if (!next) break;
            const nn = index.noteOfHead.get(next.headId)!;
            if (next.measure !== curMi && next.measure !== curMi + 1) break;
            extra += toNumber(nn.duration) * (240 / qpm);
            cur = next.headId;
            curMi = next.measure;
          }
          dur = (dur + extra) * (extra ? 1 : ratio);
          events.push({
            time: start,
            duration: Math.max(0.05, dur),
            midi: midi(h.pitch),
            velocity,
            partId: part.id,
            headId: h.id,
          });
        }
      }
    }
    time += measureSeconds;
  }
  events.sort((a, b) => a.time - b.time);
  return { events, measures: marks, duration: time };
}
