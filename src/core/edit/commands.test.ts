import { describe, expect, it } from 'vitest';
import type { Note, Score } from '../model/types';
import { frac, type Fraction } from '../theory/fraction';
import { formatPitch, parsePitch } from '../theory/pitch';
import {
  copyRange,
  deleteMeasures,
  enterPitch,
  fillMeasures,
  insertMeasures,
  makeTuplet,
  moveRangeToPart,
  movePitch,
  overfullVoices,
  pasteRange,
  setDuration,
  spellSemitone,
  toggleSlur,
  toggleTie,
  toRest,
  addChordTone,
  applyAlternative,
  melodyAlternatives,
} from './commands';
import { duplicatePartAs } from '../transpose/transpose';
import { History } from './history';

/** 4/4、各小節に4分音符を4つ（'-' は休符）。パートは P1（フルート）と P2（ピアノ） */
function makeScore(measures: string[][], fifths = 0): Score {
  const notes: Note[] = [];
  let k = 0;
  measures.forEach((ps, mi) =>
    ps.forEach((p, i) => {
      notes.push({
        id: `n${mi}-${i}`,
        partId: 'P1',
        measure: mi,
        staff: 1,
        voice: 1,
        onset: frac(i, 4),
        duration: frac(1, 4),
        heads: p === '-' ? [] : [{ id: `h${k++}`, pitch: parsePitch(p) }],
        articulations: [],
        origin: 'source',
      });
    }),
  );
  return {
    schemaVersion: 1,
    id: 's',
    title: '',
    composer: '',
    parts: [
      { id: 'P1', name: 'Fl', instrumentId: 'flute', staves: 1 },
      { id: 'P2', name: 'Pf', instrumentId: 'piano', staves: 1 },
    ],
    measures: measures.map((_, i) => ({
      index: i,
      displayNumber: String(i + 1),
      ...(i === 0 ? { key: { fifths, mode: 'major' as const }, time: { beats: 4, beatType: 4 } } : {}),
    })),
    notes,
    directions: [],
    clefs: [],
  };
}
const voice = (s: Score, mi = 0, part = 'P1') =>
  s.notes
    .filter((n) => n.partId === part && n.measure === mi && !n.grace)
    .sort((a, b) => a.onset.num / a.onset.den - b.onset.num / b.onset.den)
    .map((n) => `${n.heads.map((h) => formatPitch(h.pitch)).join('+') || 'r'}:${n.duration.num}/${n.duration.den}`);
const f = (n: number, d: number): Fraction => frac(n, d);

describe('音高', () => {
  it('半音の綴り：調号の音 → 変化記号なし → 上は♯・下は♭', () => {
    const G = { fifths: 1, mode: 'major' as const };
    const C = { fifths: 0, mode: 'major' as const };
    expect(formatPitch(spellSemitone(parsePitch('F4'), 1, G))).toBe('F♯4');
    expect(formatPitch(spellSemitone(parsePitch('C4'), 1, C))).toBe('C♯4');
    expect(formatPitch(spellSemitone(parsePitch('D4'), -1, C))).toBe('D♭4');
    expect(formatPitch(spellSemitone(parsePitch('B4'), 1, C))).toBe('C5');
  });
  it('音階で上下・オクターブ・異名同音の切り替え', () => {
    const s = makeScore([['C5', 'E5', 'G5', 'A#4']], 2);
    expect(voice(movePitch(s, ['h0'], 'step-up').score)[0]).toBe('D5:1/4');
    expect(voice(movePitch(s, ['h1'], 'step-up').score)[1]).toBe('F♯5:1/4'); // ニ長調なので F♯
    expect(voice(movePitch(s, ['h2'], 'octave-down').score)[2]).toBe('G4:1/4');
    expect(voice(movePitch(s, ['h3'], 'enharmonic').score)[3]).toBe('B♭4:1/4');
  });
  it('音名で入力：休符を直前の音に近いオクターブの音にして、次へ進む', () => {
    const s = makeScore([['B4', '-', '-', '-']]);
    const r = enterPitch(s, 'n0-1', 'C');
    expect(voice(r.score)[1]).toBe('C5:1/4'); // B4 から近いのは C5
    expect(r.select).toEqual({ kind: 'note', noteId: 'n0-2' });
  });
  it('和音はピアノなど和音を弾ける楽器だけ', () => {
    const s = makeScore([['C5', 'D5', 'E5', 'F5']]);
    expect(addChordTone(s, 'n0-0', 'E').message).toContain('和音を弾けない');
  });
});

describe('音価（上書き方式）', () => {
  it('長くすると後ろの音を削る', () => {
    const r = setDuration(makeScore([['C5', 'D5', 'E5', 'F5']]), 'n0-0', 'half');
    expect(voice(r.score)).toEqual(['C5:1/2', 'E5:1/4', 'F5:1/4']);
  });
  it('短くすると休符で埋める', () => {
    const r = setDuration(makeScore([['C5', 'D5', 'E5', 'F5']]), 'n0-1', 'eighth');
    expect(voice(r.score)).toEqual(['C5:1/4', 'D5:1/8', 'r:1/8', 'E5:1/4', 'F5:1/4']);
  });
  it('付点で後ろの音の途中まで来たら、残りは休符', () => {
    const r = setDuration(makeScore([['C5', 'D5', 'E5', 'F5']]), 'n0-0', 'quarter', 1);
    expect(voice(r.score)).toEqual(['C5:3/8', 'r:1/8', 'E5:1/4', 'F5:1/4']);
  });
  it('小節からはみ出しても切らず、警告にする', () => {
    const r = setDuration(makeScore([['C5', 'D5', 'E5', 'F5']]), 'n0-3', 'half');
    expect(overfullVoices(r.score)).toEqual([{ partId: 'P1', measure: 0, staff: 1, voice: 1, over: f(1, 4) }]);
  });
  it('3連符にする', () => {
    const r = makeTuplet(makeScore([['C5', 'D5', 'E5', 'F5']]), 'n0-0');
    expect(voice(r.score)).toEqual(['C5:1/12', 'r:1/12', 'r:1/12', 'D5:1/4', 'E5:1/4', 'F5:1/4']);
    const t = r.score.notes.filter((n) => n.tuplets).map((n) => n.tuplets![0]);
    expect(t.map((x) => [x.start, x.stop])).toEqual([
      [true, undefined],
      [undefined, undefined],
      [undefined, true],
    ]);
  });
  it('休符にする', () => {
    expect(voice(toRest(makeScore([['C5', 'D5', 'E5', 'F5']]), ['n0-1']).score)).toEqual([
      'C5:1/4',
      'r:1/4',
      'E5:1/4',
      'F5:1/4',
    ]);
  });
  it('拍が足りない小節を休符で埋める', () => {
    const s = makeScore([['C5', 'D5', 'E5', 'F5']]);
    const short = { ...s, notes: s.notes.filter((n) => n.id !== 'n0-3') };
    expect(voice(fillMeasures(short, [0]))).toEqual(['C5:1/4', 'D5:1/4', 'E5:1/4', 'r:1/4']);
  });
});

describe('つなぎ', () => {
  it('タイは次が同じ高さのときだけ', () => {
    const s = makeScore([['C5', 'C5', 'D5', 'F5']]);
    const r = toggleTie(s, 'n0-0');
    expect(r.score.notes.find((n) => n.id === 'n0-0')!.heads[0].tie).toEqual({ start: true });
    expect(r.score.notes.find((n) => n.id === 'n0-1')!.heads[0].tie).toEqual({ stop: true });
    expect(toggleTie(r.score, 'n0-0').score.notes.find((n) => n.id === 'n0-1')!.heads[0].tie).toBeUndefined();
    expect(toggleTie(s, 'n0-1').message).toContain('同じ高さ');
  });
  it('スラーの付け外し', () => {
    const s = makeScore([['C5', 'D5', 'E5', 'F5']]);
    const on = toggleSlur(s, 'n0-3', 'n0-0').score;
    expect(on.notes.find((n) => n.id === 'n0-0')!.slurs?.[0].type).toBe('start');
    expect(on.notes.find((n) => n.id === 'n0-3')!.slurs?.[0].type).toBe('stop');
    const off = toggleSlur(on, 'n0-0', 'n0-3').score;
    expect(off.notes.every((n) => !n.slurs?.length)).toBe(true);
  });
});

describe('範囲と小節', () => {
  const s = makeScore([
    ['C5', 'D5', 'E5', 'F5'],
    ['G5', 'A5', 'B5', 'C6'],
    ['-', '-', '-', '-'],
  ]);
  it('コピー → 貼り付け（上書き）', () => {
    const clip = copyRange(s, { partIds: ['P1'], start: 0, end: 1 });
    const r = pasteRange(s, ['P1'], 2, clip);
    expect(voice(r.score, 2)).toEqual(['C5:1/4', 'D5:1/4', 'E5:1/4', 'F5:1/4']);
    expect(voice(r.score, 0)).toEqual(voice(s, 0));
  });
  it('別のパートへ移す（元は全休符）', () => {
    const r = moveRangeToPart(s, { partIds: ['P1'], start: 1, end: 2 }, 'P2');
    expect(voice(r.score, 1, 'P2')).toEqual(['G5:1/4', 'A5:1/4', 'B5:1/4', 'C6:1/4']);
    expect(voice(r.score, 1, 'P1')).toEqual(['r:1/1']);
  });
  it('小節の挿入と削除（全パート、番号を振り直す）', () => {
    const ins = insertMeasures(s, 1).score;
    expect(ins.measures.map((m) => m.displayNumber)).toEqual(['1', '2', '3', '4']);
    expect(voice(ins, 2)).toEqual(voice(s, 1));
    expect(voice(ins, 1, 'P2')).toEqual(['r:1/1']);
    const del = deleteMeasures(ins, 1, 2).score;
    expect(voice(del, 1)).toEqual(voice(s, 1));
    expect(del.measures).toHaveLength(3);
    expect(del.measures[0].time).toEqual({ beats: 4, beatType: 4 });
  });
});

describe('元に戻す・やり直し', () => {
  it('100回まで戻せる', () => {
    const h = new History(100);
    let cur = makeScore([['C5', 'D5', 'E5', 'F5']]);
    const first = cur;
    for (let i = 0; i < 120; i++) {
      h.push({ score: cur, changed: [0], label: '上げる' });
      cur = movePitch(cur, [cur.notes[0].heads[0].id], 'semitone-up').score;
    }
    let undone = 0;
    while (h.canUndo) {
      cur = h.undo(cur)!.score;
      undone++;
    }
    expect(undone).toBe(100);
    expect(cur).not.toBe(first); // 最初の20回分は戻せない
    const back = h.redo(cur)!.score;
    expect(back).not.toBe(cur);
  });

  it('楽譜と一緒に extra（編曲の割当表など）も戻る・やり直せる', () => {
    const h = new History(100);
    const s0 = makeScore([['C5']]);
    const s1 = makeScore([['D5']]);
    h.push({ score: s0, changed: [0], label: '割当の変更', extra: 'A' });
    const u = h.undo(s1, 'B')!;
    expect([u.score, u.extra]).toEqual([s0, 'A']);
    const r = h.redo(s0, 'A')!;
    expect([r.score, r.extra]).toEqual([s1, 'B']);
  });
});

describe('鍵盤で入力', () => {
  it('高さどおりの音を、調号に合わせた綴りで', async () => {
    const { enterMidi } = await import('./commands');
    const s = makeScore([['-', '-', '-', '-']], -3);
    expect(voice(enterMidi(s, 'n0-0', 63).score)[0]).toBe('E♭4:1/4'); // ハ短調（♭3つ）なので E♭
    expect(voice(enterMidi(s, 'n0-0', 66).score)[0]).toBe('F♯4:1/4');
    expect(voice(enterMidi(s, 'n0-0', 60).score)[0]).toBe('C4:1/4');
  });
});

describe('取り出した旋律の手直し', () => {
  it('元のパートで同じ位置の別の音に差し替えられる', () => {
    const base = makeScore([['C4', 'D4', 'E4', 'F4']]);
    // ピアノのパートに和音（C4+E4+G4）を置き、そこからフルートの旋律を取り出す
    const piano: Note[] = base.notes.map((n) => ({
      ...n,
      id: `p${n.id}`,
      partId: 'P2',
      heads: [
        ...n.heads.map((h) => ({ ...h, id: `p${h.id}` })),
        { id: `p${n.id}-3`, pitch: { ...n.heads[0].pitch, step: n.heads[0].pitch.step === 'C' ? 'G' : 'A' } },
      ],
    }));
    const src = { ...base, notes: [...base.notes, ...piano] };
    const { score, partId } = duplicatePartAs(src, { sourcePartId: 'P2', instrumentId: 'flute' });
    expect(voice(score, 0, partId)).toEqual(['G4:1/4', 'A4:1/4', 'A4:1/4', 'A4:1/4']);
    const first = score.notes.find((n) => n.partId === partId && n.onset.num === 0)!;
    const alts = melodyAlternatives(score, first.id);
    expect(alts.map((a) => formatPitch(a.pitch))).toEqual(['C4']);
    const r = applyAlternative(score, first.id, alts[0]);
    expect(voice(r.score, 0, partId)[0]).toBe('C4:1/4');
    expect(r.score.notes.find((n) => n.id === first.id)?.origin).toBe('edited');
    // 元の楽譜にある音には候補がない
    expect(melodyAlternatives(score, 'n0-0')).toEqual([]);
  });
});
