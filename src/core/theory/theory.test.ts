import { describe, expect, it } from 'vitest';
import { add, cmp, frac, fromDivisions, toDivisions } from './fraction';
import { formatInterval, intervalBetween, invert, parseInterval, transposePitch, withDirection } from './interval';
import { fifthsOfTonic, keyAlterations, normalizeKey, simplestKey, tonicOf, transposeKey } from './key';
import { intervalName, keyName, noteName, transpositionName } from './names';
import { formatPitch, midi, parsePitch, simplifyEnharmonic, STEPS, type Pitch } from './pitch';

const P = parsePitch;
const T = (p: string, iv: string, dir: 'up' | 'down' = 'up') =>
  formatPitch(transposePitch(P(p), withDirection(parseInterval(iv), dir)));

describe('分数', () => {
  it('約分と計算', () => {
    expect(frac(2, 8)).toEqual({ num: 1, den: 4 });
    expect(add(frac(1, 3), frac(1, 6))).toEqual(frac(1, 2));
    expect(cmp(frac(1, 3), frac(1, 4))).toBeGreaterThan(0);
  });
  it('MusicXMLのdivisionsとの変換', () => {
    expect(fromDivisions(480, 480)).toEqual(frac(1, 4));
    expect(fromDivisions(160, 480)).toEqual(frac(1, 12)); // 3連8分
    expect(toDivisions(frac(1, 12), 3)).toBe(1);
    expect(toDivisions(frac(1, 12), 2)).toBeNull();
  });
});

describe('音高', () => {
  it('MIDI番号', () => {
    expect(midi(P('C4'))).toBe(60);
    expect(midi(P('A4'))).toBe(69);
    expect(midi(P('B#3'))).toBe(60);
    expect(midi(P('Cb4'))).toBe(59);
  });
  it('異名同音で簡単にする', () => {
    expect(formatPitch(simplifyEnharmonic(P('B#3')))).toBe('C4');
    expect(formatPitch(simplifyEnharmonic(P('Fx4')))).toBe('G4');
    expect(formatPitch(simplifyEnharmonic(P('Ebb4')))).toBe('D4');
  });
});

describe('音程と移調（度数で計算する）', () => {
  it('度数どおりに綴る', () => {
    expect(T('A4', 'M2')).toBe('B4');
    expect(T('A#4', 'm2')).toBe('B4');
    expect(T('Bb4', 'M2')).toBe('C5');
    expect(T('C4', 'A4')).toBe('F♯4');
    expect(T('C4', 'd5')).toBe('G♭4');
    expect(T('E4', 'M3')).toBe('G♯4');
    expect(T('F#4', 'A1')).toBe('F𝄪4');
    expect(T('C4', 'P8', 'down')).toBe('C3');
    expect(T('D4', 'M9', 'up')).toBe('E5');
  });
  it('移調楽器：B♭クラは長2度下、F管ホルンは完全5度下、E♭アルトサックスは長6度下が鳴る', () => {
    expect(T('D4', 'M2', 'down')).toBe('C4');
    expect(T('G4', 'P5', 'down')).toBe('C4');
    expect(T('A4', 'M6', 'down')).toBe('C4');
  });
  it('音程を文字にする', () => {
    for (const s of ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8', 'M9']) {
      expect(formatInterval(parseInterval(s))).toBe(s);
    }
    expect(formatInterval(intervalBetween(P('C4'), P('E4')))).toBe('M3');
  });
  it('全12調の主音×主要音程で、移調→逆移調が元に戻る', () => {
    const tonics = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
    const intervals = ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
    // 調の中の7音と、よく出る臨時記号（♯4・♭7）で確かめる
    for (const t of tonics) {
      const tonic = P(`${t}4`);
      const scale: Pitch[] = [0, 1, 2, 3, 4, 5, 6].map((i) =>
        transposePitch(tonic, { diatonic: i, chromatic: [0, 2, 4, 5, 7, 9, 11][i] }),
      );
      scale.push(transposePitch(tonic, parseInterval('A4')), transposePitch(tonic, parseInterval('m7')));
      for (const ivText of intervals) {
        for (const dir of ['up', 'down'] as const) {
          const iv = withDirection(parseInterval(ivText), dir);
          for (const p of scale) {
            let moved: Pitch;
            try {
              moved = transposePitch(p, iv);
            } catch {
              continue; // ±2 を超える綴りになる組み合わせは対象外（自動で異名同音にする仕様）
            }
            expect(transposePitch(moved, invert(iv))).toEqual(p);
          }
        }
      }
    }
  });
});

describe('調号', () => {
  it('調号で変化する音', () => {
    expect(keyAlterations(3)).toMatchObject({ F: 1, C: 1, G: 1, D: 0 });
    expect(keyAlterations(-2)).toMatchObject({ B: -1, E: -1, A: 0 });
  });
  it('主音と fifths', () => {
    expect(fifthsOfTonic({ step: 'A', alter: 0 }, 'major')).toBe(3);
    expect(fifthsOfTonic({ step: 'B', alter: -1 }, 'major')).toBe(-2);
    expect(fifthsOfTonic({ step: 'C', alter: 0 }, 'minor')).toBe(-3);
    for (let f = -7; f <= 7; f++) {
      for (const mode of ['major', 'minor'] as const) {
        const t = tonicOf({ fifths: f, mode });
        expect(fifthsOfTonic(t, mode)).toBe(f);
      }
    }
  });
  it('B♭クラ譜：Aメジャー → Bメジャー（♯5）、B♭メジャー → Cメジャー（調号なし）', () => {
    const toClarinet = parseInterval('M2'); // 記譜は長2度上
    expect(transposeKey({ fifths: 3, mode: 'major' }, toClarinet).fifths).toBe(5);
    expect(transposeKey({ fifths: -2, mode: 'major' }, toClarinet).fifths).toBe(0);
  });
  it('Aクラ（短3度上）・F管ホルン（完全5度上）・E♭アルトサックス（長6度上）', () => {
    expect(transposeKey({ fifths: 0, mode: 'major' }, parseInterval('m3')).fifths).toBe(-3); // E♭
    expect(transposeKey({ fifths: 0, mode: 'major' }, parseInterval('P5')).fifths).toBe(1); // G
    expect(transposeKey({ fifths: 0, mode: 'major' }, parseInterval('M6')).fifths).toBe(3); // A
  });
  it('♯♭7つを超える調は異名同音へ、6つ同士は♯系を既定に', () => {
    expect(normalizeKey({ fifths: 8, mode: 'major' }).fifths).toBe(-4); // G♯ → A♭
    expect(simplestKey({ fifths: -6, mode: 'major' }).fifths).toBe(6); // G♭ → F♯
    expect(simplestKey({ fifths: -6, mode: 'major' }, 'flat').fifths).toBe(-6);
    expect(simplestKey({ fifths: 7, mode: 'major' }).fifths).toBe(-5); // C♯ → D♭
  });
  it('STEPS の順序', () => {
    expect(STEPS.join('')).toBe('CDEFGAB');
  });
});

describe('画面に出す名前', () => {
  it('調・音程', () => {
    expect(keyName({ fifths: 3, mode: 'major' })).toBe('Aメジャー（♯3つ）');
    expect(keyName({ fifths: -3, mode: 'minor' })).toBe('Cマイナー（♭3つ）');
    expect(keyName({ fifths: -6, mode: 'major' })).toBe('G♭メジャー（♭6つ）');
    expect(intervalName(parseInterval('M2'))).toBe('長2度');
    expect(transpositionName({ diatonic: -1, chromatic: -2 })).toBe('記譜の長2度下が鳴る');
    expect(transpositionName({ diatonic: 7, chromatic: 12 })).toBe('記譜の完全8度上が鳴る');
    expect(transpositionName(null)).toBe('記譜どおり');
  });
});

describe('音名', () => {
  it('固定ド・英語・ドイツ語', () => {
    expect(noteName({ step: 'F', alter: 1 }, 'doremi')).toBe('ファ♯');
    expect(noteName({ step: 'B', alter: -1 }, 'english')).toBe('B♭');
    expect(['C', 'Cis', 'Es', 'As', 'B', 'H', 'Fis', 'Eses', 'Ases', 'Ces'].join()).toBe(
      [
        { step: 'C', alter: 0 },
        { step: 'C', alter: 1 },
        { step: 'E', alter: -1 },
        { step: 'A', alter: -1 },
        { step: 'B', alter: -1 },
        { step: 'B', alter: 0 },
        { step: 'F', alter: 1 },
        { step: 'E', alter: -2 },
        { step: 'A', alter: -2 },
        { step: 'C', alter: -1 },
      ]
        .map((p) => noteName(p, 'german'))
        .join(),
    );
  });
});
