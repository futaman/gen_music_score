// 検証者のロジック検証（L3）。項目は docs/verification/spec.md の ID。期待値は docs/spec.md から決めている。

import 'fake-indexeddb/auto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import thresholds from '../../../config/thresholds.json';
import { checkArrangement } from '../../../src/core/arrange/check';
import { createArrangement, reassign } from '../../../src/core/arrange/workspace';
import { checkRanges } from '../../../src/core/check/range';
import {
  addChordTone,
  deleteMeasures,
  fillMeasures,
  insertMeasures,
  movePitch,
  nearestPitch,
  overfullVoices,
  setDuration,
  setKeySignature,
  setTimeSignature,
} from '../../../src/core/edit/commands';
import { History } from '../../../src/core/edit/history';
import { getInstrument, partTransposition } from '../../../src/core/instruments';
import { writtenKey, writtenPitch } from '../../../src/core/model/display';
import { parseProjectJson, projectToJson } from '../../../src/core/model/projectFile';
import { newProject } from '../../../src/core/model/schema';
import { buildScoreIndex } from '../../../src/core/model/scoreIndex';
import type { Score } from '../../../src/core/model/types';
import { diffScores } from '../../../src/core/musicxml/compare';
import { ImportError } from '../../../src/core/musicxml/errors';
import { exportMusicXml } from '../../../src/core/musicxml/export';
import { decodeScoreFile, readScoreFile } from '../../../src/core/musicxml/file';
import { importMusicXml } from '../../../src/core/musicxml/import';
import { buildTimeline, playOrder } from '../../../src/core/playback/timeline';
import { invert, parseInterval } from '../../../src/core/theory/interval';
import { duplicatePartAs, intervalToKey, transposeConcert } from '../../../src/core/transpose/transpose';
import { deleteProject, listProjects, putProject, saveProject } from '../../../src/storage/projects';
import { assetNames, buildScore, diatonicOf, loadAsset, midiOf, P, pitchMap, voiceLengths } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const xmlScore = (measures: string, partName = 'Flute', extra = '') =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list><part id="P1">${measures}</part>${extra}</score-partwise>`;
const attrs =
  '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const xnote = (step: string, dur: number, type: string, inner = '') =>
  `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>${dur}</duration><type>${type}</type>${inner}</note>`;

// ---------------------------------------------------------------- 読み込み・書き出し

describe('IO 読み込み・書き出し', () => {
  it.each(assetNames())('IO-01 往復で音符情報が変わらない：%s', (name) => {
    const a = loadAsset(name);
    const b = importMusicXml(exportMusicXml(a)).score;
    const d = diffScores(a, b);
    expect(d.onlyInA.slice(0, 5)).toEqual([]);
    expect(d.onlyInB.slice(0, 5)).toEqual([]);
    expect(b.parts.length).toBe(a.parts.length);
    expect(b.measures.length).toBe(a.measures.length);
    expect(b.measures.map((m) => m.key?.fifths ?? null)).toEqual(a.measures.map((m) => m.key?.fifths ?? null));
    expect(b.measures.map((m) => (m.time ? `${m.time.beats}/${m.time.beatType}` : ''))).toEqual(
      a.measures.map((m) => (m.time ? `${m.time.beats}/${m.time.beatType}` : '')),
    );
    expect(b.clefs.length).toBe(a.clefs.length);
  });

  it('IO-02 移調楽器は実音で持ち、書き出しは記譜音＋<transpose>', () => {
    const score = loadAsset('synthetic-orchestra-500.musicxml');
    const xml = exportMusicXml(score);
    const cases = [
      { name: /Clarinet in B♭ 1/, chromatic: -2, diatonic: -1 },
      { name: /Horn in E♭ 1/, chromatic: -9, diatonic: -5 },
    ];
    for (const c of cases) {
      const part = score.parts.find((p) => c.name.test(p.name))!;
      expect(part, String(c.name)).toBeTruthy();
      const body = new RegExp(`<part id="${part.id}">([\\s\\S]*?)</part>`).exec(xml)![1];
      expect(body).toContain(`<chromatic>${c.chromatic}</chromatic>`);
      expect(body).toContain(`<diatonic>${c.diatonic}</diatonic>`);
      // 書き出した音名（記譜）の MIDI 番号の集まり ＝ 内部の実音 − 移調量
      const written = [...body.matchAll(/<pitch>([\s\S]*?)<\/pitch>/g)].map((m) => {
        const step = /<step>(\w)<\/step>/.exec(m[1])![1];
        const alter = Number(/<alter>(-?\d+)<\/alter>/.exec(m[1])?.[1] ?? 0);
        const octave = Number(/<octave>(-?\d+)<\/octave>/.exec(m[1])![1]);
        return midiOf({ step: step as 'C', alter: alter as 0, octave });
      });
      const concert = score.notes
        .filter((n) => n.partId === part.id)
        .flatMap((n) => n.heads.filter((h) => !h.unpitched).map((h) => midiOf(h.pitch) - c.chromatic));
      expect(written.sort((x, y) => x - y)).toEqual(concert.sort((x, y) => x - y));
    }
  });

  it('IO-03 20MB を超えるファイルは理由を出して断る（20MB ちょうどは大きさでは断らない）', () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    expect(() => decodeScoreFile(big)).toThrowError(/20MB/);
    try {
      decodeScoreFile(new Uint8Array(20 * 1024 * 1024));
    } catch (e) {
      expect((e as ImportError).code).not.toBe('too-large');
    }
  });

  it('IO-04 形式違い・壊れたファイルは理由を出す', () => {
    const reason = (bytes: Uint8Array, name = '') => {
      try {
        readScoreFile(bytes, name);
      } catch (e) {
        return e instanceof ImportError ? `${e.code}:${e.message}` : `other:${(e as Error).message}`;
      }
      return 'no-error';
    };
    expect(reason(enc('PK\x03\x04 broken zip data'), 'x.mxl')).toMatch(/^broken:/);
    expect(reason(enc('hello, this is not a score'), 'a.txt')).toMatch(/^unsupported-format:.*MusicXML/);
    expect(reason(enc('%PDF-1.7 ...'), 'a.pdf')).toMatch(/^unsupported-format:.*Audiveris/);
    // XML の形は MusicXML だが中身が壊れている
    expect(reason(enc('<score-partwise version="4.0"><part-list>'), 'a.musicxml')).not.toBe('no-error');
    expect(reason(enc('<score-partwise version="4.0"><part-list>'), 'a.musicxml')).not.toMatch(/^other:/);
  });

  it('IO-05 未対応の要素があっても読み込みを続け、無視した要素を一覧にする', () => {
    const xml = xmlScore(
      `<measure number="1">${attrs}<print new-system="yes"/><unknown-thing/><figured-bass><figure><figure-number>6</figure-number></figure></figured-bass>${xnote('C', 4, 'whole')}</measure>`,
    );
    const r = importMusicXml(xml);
    expect(r.score.notes.filter((n) => n.heads.length)).toHaveLength(1);
    expect(r.ignored.map((i) => i.name)).toEqual(expect.arrayContaining(['unknown-thing', 'print']));
    // 仕様で「無視」と決めた要素（改段など）は expected、それ以外は expected でない
    expect(r.ignored.find((i) => i.name === 'print')?.expected).toBe(true);
    expect(r.ignored.find((i) => i.name === 'unknown-thing')?.expected).toBe(false);
  });

  it('IO-06 拍が合わない小節は警告扱いで読み込みを続ける', () => {
    const xml = xmlScore(`<measure number="1">${attrs}${xnote('C', 4, 'whole')}${xnote('D', 2, 'half')}</measure>`);
    const r = importMusicXml(xml);
    expect(r.score.notes.filter((n) => n.heads.length)).toHaveLength(2);
    expect(r.warnings.length + overfullVoices(r.score).length).toBeGreaterThan(0);
  });

  it('IO-11 本当に拍の足りない小節は、隣も短くても（反復記号・弱起の印がなければ）警告する', () => {
    // 読み取りソフトの誤りでよくある形：4/4 で2拍しかない小節が2つ続く。合わせると1小節になるが、分割された小節ではない
    const xml = xmlScore(
      `<measure number="1">${attrs}${xnote('C', 4, 'whole')}</measure><measure number="2">${xnote('D', 2, 'half')}</measure>` +
        `<measure number="3">${xnote('E', 2, 'half')}</measure><measure number="4">${xnote('F', 4, 'whole')}</measure>`,
    );
    const short = importMusicXml(xml)
      .warnings.filter((w) => w.code === 'measure-length')
      .map((w) => w.measure);
    expect(short).toEqual([1, 2]);
  });

  it('IO-08 保持のみの要素（歌詞・コード記号・運指）を書き出しに残す', () => {
    const xml = xmlScore(
      `<measure number="1">${attrs}<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>${xnote(
        'C',
        4,
        'whole',
        '<notations><technical><fingering>3</fingering></technical></notations><lyric number="1"><syllabic>single</syllabic><text>ら</text></lyric>',
      )}</measure>`,
    );
    const out = exportMusicXml(importMusicXml(xml).score);
    expect(out).toContain('<text>ら</text>');
    expect(out).toContain('<fingering>3</fingering>');
    expect(out).toContain('<root-step>C</root-step>');
  });
});

// ---------------------------------------------------------------- 移調

const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLATS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
/** 調号どおりの音階（4オクターブ目）と、半音上げた音・下げた音を1つずつ */
function keyScore(fifths: number) {
  const alterOf = (step: string) =>
    fifths > 0 ? (SHARPS.slice(0, fifths).includes(step) ? 1 : 0) : FLATS.slice(0, -fifths).includes(step) ? -1 : 0;
  const tok = (step: string, alter: number) => `${step}${alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)}4:8`;
  const scale = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'].map((s) => tok(s, alterOf(s))).join(' ');
  const chroma = `${tok('F', alterOf('F') + 1)} ${tok('B', alterOf('B') - 1)} -:4 -:2`;
  return buildScore({ fl: { instrument: 'flute', measures: [scale, chroma] } }, [{ key: { fifths, mode: 'major' } }]);
}

const MAIN_INTERVALS = ['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8', 'M9', 'P12'];
const OTHER_INTERVALS = ['A1', 'A4', 'd5', 'A2', 'd7', 'A5', 'd4'];

describe('TR 移調', () => {
  const cases: [number, string, 'up' | 'down'][] = [];
  for (let f = -7; f <= 7; f++)
    for (const iv of [...MAIN_INTERVALS, ...OTHER_INTERVALS])
      for (const d of ['up', 'down'] as const) cases.push([f, iv, d]);

  it('TR-01 全15調×20音程×上下：移調→逆移調で元と完全一致（自動置換オフ）。主要音程で6つ以下の調は書き換えなし', () => {
    const failures: string[] = [];
    const respelledMain: string[] = [];
    for (const [f, ivText, dir] of cases) {
      const src = keyScore(f);
      const iv = dir === 'up' ? parseInterval(ivText) : invert(parseInterval(ivText));
      const label = `${f} ${ivText} ${dir}`;
      let fw: ReturnType<typeof transposeConcert>, back: ReturnType<typeof transposeConcert>;
      try {
        fw = transposeConcert(src, { interval: iv, enharmonicKeys: false });
        back = transposeConcert(fw.score, { interval: invert(iv), enharmonicKeys: false });
      } catch (e) {
        failures.push(`${label}: 例外 ${(e as Error).message}`);
        continue;
      }
      // 実音は必ず chromatic だけ動く
      const before = pitchMap(src);
      for (const [id, p] of pitchMap(fw.score))
        if (midiOf(p) !== midiOf(before.get(id)!) + iv.chromatic) failures.push(`${label}: MIDI ずれ ${id}`);
      if (fw.respelled === 0 && back.respelled === 0) {
        // 音名も度数どおり、戻すと完全一致
        for (const [id, p] of pitchMap(fw.score))
          if (diatonicOf(p) !== diatonicOf(before.get(id)!) + iv.diatonic) failures.push(`${label}: 度数ずれ ${id}`);
        if (diffScores(src, back.score).onlyInA.length) failures.push(`${label}: 戻らない`);
        if (back.score.measures[0].key?.fifths !== f) failures.push(`${label}: 調が戻らない`);
      }
      if (MAIN_INTERVALS.includes(ivText) && Math.abs(f) <= 6 && fw.respelled > 0) respelledMain.push(label);
    }
    expect(failures).toEqual([]);
    expect(respelledMain).toEqual([]);
  });

  it.each(['mozart-k464-1-allegro.mxl', 'mozart-k387.mxl', 'beethoven-op18-1.mxl'])(
    'TR-01 実際の曲全体（%s）を短2度上げて戻すと完全一致（自動置換オフ）',
    (name) => {
      const src = loadAsset(name);
      const iv = parseInterval('m2');
      const fw = transposeConcert(src, { interval: iv, enharmonicKeys: false }).score;
      const back = transposeConcert(fw, { interval: invert(iv), enharmonicKeys: false }).score;
      expect(diffScores(src, back)).toEqual({ onlyInA: [], onlyInB: [] });
      expect(back.measures.map((m) => m.key?.fifths)).toEqual(src.measures.map((m) => m.key?.fifths));
    },
  );

  it('TR-02 自動置換オンで往復すると、実音（MIDI番号）が一致する', () => {
    const src = keyScore(4); // Eメジャー
    const iv = parseInterval('M3'); // → G♯メジャー（♯8つ）→ A♭メジャー
    const fw = transposeConcert(src, { interval: iv }).score;
    const back = transposeConcert(fw, { interval: invert(iv) }).score;
    const before = pitchMap(src);
    for (const [id, p] of pitchMap(back)) expect(midiOf(p), id).toBe(midiOf(before.get(id)!));
  });

  it('TR-03 ♯・♭が7つを超える調は異名同音の調へ。オプションで無効化。ちょうど7つはそのまま', () => {
    expect(transposeConcert(keyScore(4), { interval: parseInterval('M3') }).score.measures[0].key?.fifths).toBe(-4);
    expect(
      transposeConcert(keyScore(4), { interval: parseInterval('M3'), enharmonicKeys: false }).score.measures[0].key
        ?.fifths,
    ).toBe(8);
    expect(transposeConcert(keyScore(5), { interval: parseInterval('M2') }).score.measures[0].key?.fifths).toBe(7);
    expect(
      transposeConcert(keyScore(-4), { interval: invert(parseInterval('M3')) }).score.measures[0].key?.fifths,
    ).toBe(4); // A♭ → F♭（♭8つ）→ E
  });

  it('TR-12 「調を指定」の移調は、曲の途中に別の調があっても例外にならない（全15調→全15調×上下×途中の調15）', () => {
    const failures: string[] = [];
    for (let f1 = -7; f1 <= 7; f1++)
      for (let t = -7; t <= 7; t++)
        for (const d of ['up', 'down'] as const)
          for (let f2 = -7; f2 <= 7; f2++) {
            const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:1', 'C5:1'] } }, [
              { key: { fifths: f1, mode: 'major' } },
              { key: { fifths: f2, mode: 'major' } },
            ]);
            try {
              transposeConcert(s, { interval: intervalToKey(s.measures[0].key!, t, d), flavor: 'auto' });
            } catch (e) {
              failures.push(`${f1}→${t} ${d} 途中の調${f2}: ${(e as Error).message}`);
            }
          }
    expect(failures.length, failures.slice(0, 5).join('\n')).toBe(0);
  });

  it('TR-04 B♭クラ譜：Aメジャー → Bメジャー（♯5）、B♭メジャー → Cメジャー', () => {
    const t = partTransposition({ instrumentId: 'clarinet-bb' });
    expect(writtenKey({ fifths: 3, mode: 'major' }, t).fifths).toBe(5);
    expect(writtenKey({ fifths: -2, mode: 'major' }, t).fifths).toBe(0);
  });

  it('TR-05 移調楽器の記譜：実音 C4 の記譜音', () => {
    const w = (id: string) => {
      const p = writtenPitch(P('C4'), partTransposition({ instrumentId: id }));
      return `${p.step}${p.alter === -1 ? 'b' : p.alter === 1 ? '#' : ''}${p.octave}`;
    };
    expect(w('clarinet-bb')).toBe('D4'); // 長2度上に記譜
    expect(w('clarinet-a')).toBe('Eb4'); // 短3度上
    expect(w('horn-f')).toBe('G4'); // 完全5度上
    expect(w('trumpet-bb')).toBe('D4'); // 長2度上
    expect(w('alto-sax')).toBe('A4'); // 長6度上
    expect(w('flute')).toBe('C4');
  });

  it('TR-06 記譜の調号は記号の少ない方（同数なら♯系）が既定。♯系／♭系を選べる', () => {
    for (const id of ['clarinet-bb', 'clarinet-a', 'horn-f', 'trumpet-bb', 'alto-sax']) {
      const t = partTransposition({ instrumentId: id });
      for (let f = -7; f <= 7; f++) {
        const k = writtenKey({ fifths: f, mode: 'major' }, t).fifths;
        const alt = k > 0 ? k - 12 : k + 12;
        const label = `${id} 実音${f}`;
        expect(Math.abs(k), label).toBeLessThanOrEqual(Math.abs(alt));
        if (Math.abs(k) === Math.abs(alt)) expect(k, label).toBeGreaterThan(0);
        const sharp = writtenKey({ fifths: f, mode: 'major' }, t, 'sharp').fifths;
        const flat = writtenKey({ fifths: f, mode: 'major' }, t, 'flat').fifths;
        expect(Math.abs((sharp - k) % 12), label).toBe(0);
        expect(Math.abs((flat - k) % 12), label).toBe(0);
        if (Math.abs(k) >= 5 && k !== 0) expect(sharp, label).toBeGreaterThanOrEqual(0);
        if (Math.abs(k) >= 5 && k !== 0) expect(flat, label).toBeLessThanOrEqual(0);
      }
    }
  });

  it('TR-07 音高のないパート（打楽器）は移調しない', () => {
    const src = buildScore({
      fl: { instrument: 'flute', measures: ['C5:1'] },
      perc: { instrument: 'percussion', measures: ['C4:4 C4:4 C4:4 C4:4'] },
    });
    const r = transposeConcert(src, { interval: parseInterval('M2') }).score;
    expect(r.notes.filter((n) => n.partId === 'perc').map((n) => n.heads[0].pitch)).toEqual(
      src.notes.filter((n) => n.partId === 'perc').map((n) => n.heads[0].pitch),
    );
    expect(r.notes.find((n) => n.partId === 'fl')!.heads[0].pitch).toEqual(P('D5'));
  });

  it('TR-08 小節範囲だけの移調では、範囲の頭と直後に調号の変更が入る', () => {
    const src = buildScore({ fl: { instrument: 'flute', measures: ['C5:1', 'C5:1', 'C5:1', 'C5:1', 'C5:1'] } });
    const r = transposeConcert(src, { interval: parseInterval('M2'), range: { start: 2, end: 4 } }).score;
    expect(r.measures.map((m) => m.key?.fifths)).toEqual([0, undefined, 2, undefined, 0]);
    expect(r.notes.map((n) => midiOf(n.heads[0].pitch) - 72)).toEqual([0, 0, 2, 2, 0]);
  });

  it('TR-09 曲の途中の転調は、調の区間ごとに移調する', () => {
    const src = buildScore({ fl: { instrument: 'flute', measures: ['C5:1', 'C5:1', 'F#5:1', 'G5:1'] } }, [
      {},
      {},
      { key: { fifths: 1, mode: 'major' } },
    ]);
    const r = transposeConcert(src, { interval: parseInterval('M2') }).score;
    expect(r.measures.map((m) => m.key?.fifths)).toEqual([2, undefined, 3, undefined]);
    expect(r.notes[2].heads[0].pitch).toEqual(P('G#5'));
  });

  it('TR-10 元のパートを複製して楽器を指定する。和音のパートからは最高音を拾う。元は残る', () => {
    const src = buildScore({ pf: { instrument: 'piano', measures: ['C4+E4+G4:2 F4+A4+C5:2', 'B3+D4+G4:1'] } });
    const { score, partId } = duplicatePartAs(src, { sourcePartId: 'pf', instrumentId: 'clarinet-bb' });
    expect(score.parts.map((p) => p.id)).toEqual(['pf', partId]);
    expect(score.notes.filter((n) => n.partId === 'pf')).toEqual(src.notes);
    const mel = score.notes.filter((n) => n.partId === partId);
    expect(mel.map((n) => n.heads.length)).toEqual([1, 1, 1]);
    expect(mel.map((n) => n.heads[0].pitch)).toEqual([P('G4'), P('C5'), P('G4')]);
  });
});

// ---------------------------------------------------------------- 音域

describe('RG 音域チェック', () => {
  it('RG-01 木管5重奏の実用音域が仕様の表どおり', () => {
    const expected: Record<string, [string, string]> = {
      flute: ['C4', 'C7'],
      oboe: ['Bb3', 'G6'],
      'clarinet-bb': ['D3', 'Bb6'],
      'horn-f': ['F2', 'F5'],
      bassoon: ['Bb1', 'D5'],
    };
    for (const [id, [lo, hi]] of Object.entries(expected)) {
      const r = getInstrument(id).range.practical.map(midiOf);
      expect(r, id).toEqual([midiOf(P(lo)), midiOf(P(hi))]);
    }
  });

  it('RG-02 音域外の音を見つけ、オクターブ移動の候補を出す（端の音は音域内）', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C3:4 C4:4 C7:4 D7:4'] } });
    const issues = checkRanges(s);
    expect(issues.map((i) => [formatOf(i.pitch), i.kind, i.suggestOctaves])).toEqual([
      ['C3', 'low', 1],
      ['D7', 'high', -1],
    ]);
  });
});
const formatOf = (p: { step: string; octave: number }) => `${p.step}${p.octave}`;

// ---------------------------------------------------------------- 編集

const firstNote = (s: Score, partId = 'fl', measure = 0) =>
  s.notes
    .filter((n) => n.partId === partId && n.measure === measure)
    .sort((a, b) => a.onset.num / a.onset.den - b.onset.num / b.onset.den)[0];

describe('ED 編集', () => {
  it('ED-01 元に戻すは100回まで', () => {
    const h = new History();
    let s = buildScore({ fl: { instrument: 'flute', measures: ['C5:1'] } });
    for (let i = 0; i < 101; i++) {
      h.push({ score: s, changed: [0], label: `edit${i}` });
      s = { ...s, title: `v${i}` };
    }
    let n = 0;
    while (h.canUndo) {
      s = h.undo(s)!.score;
      n++;
    }
    expect(n).toBe(100);
    expect(s.title).toBe('v0'); // いちばん古い1回分は消える
  });

  it('ED-02 音価の変更は上書き方式：長くすると後ろを削り、短くすると休符で埋める。拍の合計は変わらない', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:4 D5:4 E5:4 F5:4'] } });
    const longer = setDuration(s, firstNote(s).id, 'half').score;
    const m0 = longer.notes
      .filter((n) => n.measure === 0)
      .sort((a, b) => a.onset.num / a.onset.den - b.onset.num / b.onset.den);
    expect(m0.map((n) => n.heads.map((h) => h.pitch.step).join('') || '-')).toEqual(['C', 'E', 'F']);
    expect(voiceLengths(longer, 'fl', 0)).toEqual([16]);

    const shorter = setDuration(s, firstNote(s).id, 'eighth').score;
    const m1 = shorter.notes
      .filter((n) => n.measure === 0)
      .sort((a, b) => a.onset.num / a.onset.den - b.onset.num / b.onset.den);
    expect(m1.map((n) => n.heads.map((h) => h.pitch.step).join('') || '-')).toEqual(['C', '-', 'D', 'E', 'F']);
    expect(voiceLengths(shorter, 'fl', 0)).toEqual([16]);
  });

  it('ED-03 入れた音は直前の音に最も近いオクターブ', () => {
    const C = { fifths: 0, mode: 'major' as const };
    expect(nearestPitch('B', C, P('C4'))).toEqual(P('B3'));
    expect(nearestPitch('G', C, P('C4'))).toEqual(P('G3'));
    expect(nearestPitch('F', C, P('C4'))).toEqual(P('F4'));
    expect(nearestPitch('D', C, P('C4'))).toEqual(P('D4'));
  });

  it('ED-04 和音は polyphonic の楽器だけに置ける', () => {
    const s = buildScore({
      fl: { instrument: 'flute', measures: ['C5:1'] },
      pf: { instrument: 'piano', measures: ['C4:1'] },
    });
    const fl = addChordTone(s, firstNote(s, 'fl').id, 'E');
    expect(fl.score.notes.find((n) => n.partId === 'fl')!.heads).toHaveLength(1);
    expect(fl.message).toBeTruthy();
    const pf = addChordTone(s, firstNote(s, 'pf').id, 'E');
    expect(pf.score.notes.find((n) => n.partId === 'pf')!.heads).toHaveLength(2);
  });

  it('ED-05 小節の挿入・削除は全パート同時', () => {
    const s = buildScore({
      fl: { instrument: 'flute', measures: ['C5:1', 'D5:1'] },
      ob: { instrument: 'oboe', measures: ['E5:1', 'F5:1'] },
    });
    const ins = insertMeasures(s, 1).score;
    expect(ins.measures).toHaveLength(3);
    for (const pid of ['fl', 'ob']) {
      expect(ins.notes.filter((n) => n.partId === pid && n.measure === 1).every((n) => n.heads.length === 0)).toBe(
        true,
      );
      expect(ins.notes.some((n) => n.partId === pid && n.measure === 2 && n.heads.length)).toBe(true);
    }
    const del = deleteMeasures(s, 0, 1).score;
    expect(del.measures).toHaveLength(1);
    expect(del.notes.map((n) => [n.partId, n.measure, n.heads[0].pitch.step])).toEqual(
      expect.arrayContaining([
        ['fl', 0, 'D'],
        ['ob', 0, 'F'],
      ]),
    );
    expect(del.measures[0].time).toBeTruthy(); // 先頭を消しても拍子・調号は残る
    expect(del.measures[0].key).toBeTruthy();
  });

  it('ED-06 調号を変えても実音を保つ', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:4 F5:4 F#5:4 Bb5:4', 'G5:1'] } });
    const r = setKeySignature(s, 0, 2).score;
    expect(r.notes.map((n) => midiOf(n.heads[0].pitch))).toEqual(s.notes.map((n) => midiOf(n.heads[0].pitch)));
    expect(r.measures[0].key?.fifths).toBe(2);
  });

  it('ED-07 拍子を変えても音を詰め直さず、拍の過不足を警告する', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:4 D5:4 E5:4 F5:4', 'G5:1'] } });
    const r = setTimeSignature(s, 0, 3, 4).score;
    expect(r.notes.map((n) => [n.measure, n.onset, n.duration])).toEqual(
      s.notes.map((n) => [n.measure, n.onset, n.duration]),
    );
    expect(overfullVoices(r).map((i) => i.measure)).toEqual(expect.arrayContaining([0, 1]));
  });

  it('ED-08 拍が足りなければ休符で埋める。超えた小節は自動で切らない', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:2', 'C5:1 D5:4'] } });
    const r = fillMeasures(s, [0, 1]);
    expect(voiceLengths(r, 'fl', 0)).toEqual([16]);
    expect(r.notes.filter((n) => n.measure === 1)).toHaveLength(2);
    expect(overfullVoices(r).map((i) => i.measure)).toEqual([1]);
  });

  it('ED-09 手で直した音は origin: edited になる', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:1'] } });
    const r = movePitch(s, [s.notes[0].heads[0].id], 'semitone-up').score;
    expect(r.notes[0].origin).toBe('edited');
    expect(midiOf(r.notes[0].heads[0].pitch)).toBe(73);
  });
});

// ---------------------------------------------------------------- 保存

describe('ST 保存', () => {
  it('ST-01 プロジェクトJSONに schemaVersion があり、保存→読み込みで楽譜が変わらない。新しい版は断る', () => {
    const p = newProject(loadAsset('mozart-k387.mxl'), 'dev');
    const json = projectToJson(p);
    expect(JSON.parse(json).schemaVersion).toBe(1);
    expect(parseProjectJson(json).sourceScore).toEqual(p.sourceScore);
    expect(() => parseProjectJson(JSON.stringify({ ...p, schemaVersion: 2 }))).toThrow(/新しい版/);
    expect(() => parseProjectJson('{oops')).toThrow();
  });

  it('ST-03 保存ごとに revision が増える', async () => {
    for (const x of await listProjects()) await deleteProject(x.id);
    const p = newProject(buildScore({ fl: { instrument: 'flute', measures: ['C5:1'] } }), 'dev');
    await putProject(p);
    const a = await saveProject(p, p.revision, 'dev');
    const b = await saveProject(a, a.revision, 'dev2');
    expect([p.revision, a.revision, b.revision]).toEqual([p.revision, p.revision + 1, p.revision + 2]);
    expect(b.updatedBy).toBe('dev2');
  });
});

// ---------------------------------------------------------------- 編曲

describe('AR 編曲（K.387 弦4部 → 木管5重奏。アイネ・クライネの代わり）', () => {
  const source = loadAsset('mozart-k387.mxl');
  const { arrangement, score } = createArrangement(source, 'wind-quintet');

  it('AR-01 5楽器のパートができ、全小節に区間がある', () => {
    expect(score.parts.map((p) => p.instrumentId)).toEqual(['flute', 'oboe', 'clarinet-bb', 'horn-f', 'bassoon']);
    expect(score.measures).toHaveLength(source.measures.length);
    const covered = arrangement.sections.flatMap((s) => Array.from({ length: s.end - s.start }, (_, i) => s.start + i));
    expect(covered).toEqual(source.measures.map((_, i) => i));
    for (const p of score.parts)
      expect(
        score.notes.some((n) => n.partId === p.id && n.heads.length),
        p.id,
      ).toBe(true);
  });

  it('AR-02 楽器あたり常に1音（重音なし）', () => {
    expect(score.notes.filter((n) => n.heads.length > 1)).toEqual([]);
  });

  it('AR-03 生成した音は origin: generated と derivedFrom を持つ', () => {
    const sounding = score.notes.filter((n) => n.heads.length);
    expect(sounding.every((n) => n.origin === 'generated')).toBe(true);
    expect(sounding.every((n) => (n.derivedFrom?.sourceNoteIds.length ?? 0) > 0)).toBe(true);
  });

  it('AR-04 オクターブ調整で生成音の95%以上が実用音域に入り、外れた音はすべて警告に出る', () => {
    const heads = score.notes.flatMap((n) => n.heads);
    const outside = checkRanges(score);
    expect(outside.length / heads.length).toBeLessThan(0.05);
    const warnings = checkArrangement(score, { source, arrangement });
    const warnedIds = new Set(warnings.filter((w) => w.kind === 'range').flatMap((w) => w.noteIds));
    expect(outside.filter((o) => !warnedIds.has(o.noteId))).toEqual([]);
  });

  it('AR-05 閾値が仕様の初期値どおり', () => {
    expect(thresholds.arrange.restRatio).toBe(0.8);
    expect(thresholds.arrange.melodyHighMidi).toBe(midiOf(P('G5')));
    expect(thresholds.arrange.doubleRhythmMatch).toBe(0.9);
    expect(thresholds.arrange.sectionFallbackMeasures).toBe(8);
    expect(thresholds.arrange.rotateMelodyAfter).toBe(2);
    expect(thresholds.warnings.breathSeconds).toBe(16);
    expect(thresholds.warnings.leapSemitones).toBe(12); // 「超える」なので > 12
    expect(thresholds.warnings.leapRepeat).toBe(2);
    expect(thresholds.warnings.hornHighMidi).toBe(midiOf(P('E5')));
    expect(thresholds.warnings.hornHighMeasures).toBe(2);
    expect(thresholds.warnings.edgeTopSemitones).toBe(4); // 長3度
    expect(thresholds.warnings.edgeBottomSemitones).toBe(2); // 長2度
    expect(thresholds.warnings.edgeBeats).toBe(4);
    expect(thresholds.warnings.melodyMissingRatio).toBe(0.05);
  });

  it('AR-05 跳躍の警告は「1オクターブを超える」跳躍だけを数える（ちょうど1オクターブは数えない）', () => {
    const octave = buildScore({ fl: { instrument: 'flute', measures: ['C5:4 C6:4 C5:4 C6:4'] } });
    expect(checkArrangement(octave).filter((w) => w.kind === 'leap')).toEqual([]);
    const ninth = buildScore({ fl: { instrument: 'flute', measures: ['C5:4 D6:4 C5:4 D6:4'] } });
    expect(checkArrangement(ninth).filter((w) => w.kind === 'leap')).toHaveLength(1);
  });

  it('AR-05 息継ぎ：休みなしで16秒以上（テンポから換算）', () => {
    // 4分 = 60 で 4/4 → 1小節4秒。4小節（16秒）続けると警告、3小節＋休符なら出ない
    const tempo = { tempo: { bpm: 60, beatUnit: { num: 1, den: 4 } } };
    const long = buildScore({ fl: { instrument: 'flute', measures: ['C5:1', 'D5:1', 'E5:1', 'F5:1', '-:1'] } }, [
      tempo,
    ]);
    expect(checkArrangement(long).filter((w) => w.kind === 'breath')).toHaveLength(1);
    const short = buildScore({ fl: { instrument: 'flute', measures: ['C5:1', 'D5:1', 'E5:1', '-:1', 'F5:1'] } }, [
      tempo,
    ]);
    expect(checkArrangement(short).filter((w) => w.kind === 'breath')).toEqual([]);
  });

  it('AR-06 割当をやり直しても、手で直した音は消えない', () => {
    const sec = arrangement.sections[0];
    const target = score.notes.find((n) => n.partId === 'flute' && n.measure === sec.start && n.heads.length)!;
    const edited = movePitch(score, [target.heads[0].id], 'semitone-up').score;
    const pitchAfterEdit = edited.notes.find((n) => n.id === target.id)!.heads[0].pitch;
    // 区間の全楽器を作り直す
    const all = reassign(source, arrangement, edited, sec.id);
    const kept = all.result.score.notes.find((n) => n.id === target.id);
    expect(kept?.heads[0].pitch).toEqual(pitchAfterEdit);
    expect(all.kept).toBeGreaterThan(0);
    // フルートの割当を別の元パートに変える
    const other = Object.values(sec.mapping)
      .flat()
      .find((u) => !sec.mapping.flute.includes(u))!;
    const one = reassign(source, arrangement, edited, sec.id, 'flute', [other]);
    expect(one.result.score.notes.find((n) => n.id === target.id)?.heads[0].pitch).toEqual(pitchAfterEdit);
  });

  it('AR-07 ティンパニ・打楽器は割当の対象外', () => {
    const big = loadAsset('synthetic-orchestra-500.musicxml');
    const perc = big.parts.filter((p) => ['timpani', 'percussion'].includes(p.instrumentId)).map((p) => p.id);
    expect(perc.length).toBeGreaterThan(0);
    const { arrangement: a } = createArrangement(big, 'wind-quintet');
    const used = a.sections.flatMap((s) => [...Object.values(s.mapping).flat(), ...Object.keys(s.roles)]);
    expect(used.filter((u) => perc.includes(u.split('#')[0]))).toEqual([]);
  });
});

// ---------------------------------------------------------------- 再生

describe('PB 再生', () => {
  it('PB-01 繰り返し記号は楽譜に残し、再生の順番だけ展開する', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:1', 'D5:1', 'E5:1', 'F5:1'] } }, [
      {},
      { repeat: 'start' },
      { repeat: 'end' },
    ]);
    expect(playOrder(s.measures)).toEqual([0, 1, 2, 1, 2, 3]);
    expect(s.measures).toHaveLength(4);
  });

  it('PB-02 スタッカートは音長50%、フェルマータは1.5倍', () => {
    const s = buildScore({ fl: { instrument: 'flute', measures: ['C5:4. D5:4 E5:4! F5:4', 'G5:4 -:4 -:2'] } }, [
      { tempo: { bpm: 60, beatUnit: { num: 1, den: 4 } } },
    ]);
    const t = buildTimeline(buildScoreIndex(s));
    const ev = (step: string) => t.events.find((e) => e.midi === midiOf(P(`${step}5`)))!;
    expect(ev('C').duration / ev('D').duration).toBeCloseTo(0.5 / 0.95, 2); // 普通の音は 95%
    expect(ev('C').duration).toBeCloseTo(0.5, 2);
    // フェルマータの音は 1.5 拍分、後ろの音もその分ずれる
    expect(ev('F').time - ev('E').time).toBeCloseTo(1.5, 2);
    expect(ev('G').time).toBeCloseTo(4.5, 2);
  });

  it('PB-03 音源のライセンスとクレジットが public/samples にある（仕様のファイル名は LICENSE）', () => {
    const dir = new URL('../../../public/samples/', import.meta.url);
    const files = readdirSync(dir);
    const license = files.find((f) => /^LICENSE/.test(f));
    expect(license).toBeTruthy();
    expect(readFileSync(new URL(license!, dir), 'utf8')).toMatch(/FluidR3/);
    // 仕様どおりのファイル名か（違っていれば報告書に記録）
    expect.soft(existsSync(new URL('LICENSE', dir)), 'public/samples/LICENSE').toBe(true);
  });
});

// ---------------------------------------------------------------- 性能（この開発環境の値。目標は PC）

describe('PF 性能', () => {
  const big = loadAsset('synthetic-orchestra-500.musicxml');

  it('PF-02 曲全体の移調が1秒以内（合成オーケストラ 500小節）', () => {
    const t = performance.now();
    transposeConcert(big, { interval: parseInterval('M2') });
    const ms = performance.now() - t;
    console.log(`[PF-02] 曲全体の移調 ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(1000);
  });

  it('PF-03 編曲案の生成（解析・割当・楽譜づくり・警告）が3秒以内', () => {
    const t = performance.now();
    const { arrangement, score } = createArrangement(big, 'wind-quintet');
    checkArrangement(score, { source: big, arrangement });
    const ms = performance.now() - t;
    console.log(`[PF-03] 編曲案 ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------- 表示オプション（仕様「表示オプション」の表）

describe('UI 表示オプション', () => {
  it('UI-09 既定値が仕様の表どおり', async () => {
    const { defaultSettings } = await import('../../../src/ui/settings');
    const pc = defaultSettings('pc');
    const phone = defaultSettings('phone');
    const tablet = defaultSettings('tablet');
    expect([pc.view, tablet.view, phone.view]).toEqual(['score', 'score', 'part']);
    expect(pc.pitchMode).toBe('written');
    expect([pc.layout, tablet.layout, phone.layout]).toEqual(['page', 'vertical', 'vertical']);
    expect(pc.zoom).toBe('fit');
    expect(pc.noteNames).toBe('none');
    expect(pc.measureNumbers).toBe('system');
    expect(pc.warnings).toBe(true);
    expect(pc.follow).toBe(true);
    expect(pc.theme).toBe('system');
    expect(pc.hornKeySignature).toBe('with');
    expect.soft(pc.showEdits, '手直しした音の表示：既定は「つけない」').toBe(false);
  });

  it('UI-09 色分けに「編曲元パートごと」がある', () => {
    const src = readFileSync(new URL('../../../src/ui/settings.ts', import.meta.url), 'utf8');
    const colorBy = /colorBy: ([^;]+);/.exec(src)![1];
    expect(colorBy, `colorBy の選択肢: ${colorBy}`).toMatch(/source|origin|part/);
  });
});
