import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readScoreFile } from '../musicxml/file';
import { exportMusicXml } from '../musicxml/export';
import { importMusicXml } from '../musicxml/import';
import { matchRate } from './compare';
import { isMidi, parseMidi } from './parse';
import { estimateKey, importMidi, importParsedMidi } from './toScore';

const read = (path: string) => new Uint8Array(readFileSync(new URL(`../../../test-assets/${path}`, import.meta.url)));

describe('MIDI の読み込み', () => {
  const bytes = read('midi/mozart-k464-1-allegro.mid');
  const r = importMidi(bytes, 'mozart-k464-1-allegro.mid');
  const xml = readScoreFile(read('musicxml/mozart-k464-1-allegro.mxl'), 'k464.mxl').score;

  it('MIDI と分かる。パート・楽器・調・拍子・弱起', () => {
    expect(isMidi(bytes)).toBe(true);
    const s = r.score;
    expect(s.parts.map((p) => p.instrumentId)).toEqual(['violin', 'violin', 'viola', 'cello']);
    expect(s.measures[0].key).toEqual({ fifths: 3, mode: 'major' });
    expect(s.measures[0].time).toEqual({ beats: 3, beatType: 4 });
    expect(s.measures[0].implicit).toBe(true);
    expect(r.warnings[0].message).toContain('MIDIから推定');
  });

  it('同じ曲の MusicXML と、音の始まり・高さが95%以上、長さも85%以上一致する', () => {
    const rate = matchRate(r.score, xml);
    console.log(
      `K.464 MIDI と MusicXML の一致率：高さ ${(rate.pitch * 100).toFixed(1)}%、長さ ${(rate.duration * 100).toFixed(1)}%（${rate.notes}音）`,
    );
    expect(rate.pitch).toBeGreaterThan(0.95);
    expect(rate.duration).toBeGreaterThan(0.85);
  });

  it('人が弾いたように時間が少しずれていても（±1/8 16分音符）、そろえて95%以上一致する', () => {
    const m = parseMidi(bytes);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const j = m.division / 4 / 8;
    const notes = m.notes.map((n) => {
      const tick = Math.max(0, Math.round(n.tick + rand() * j));
      return { ...n, tick, end: Math.max(tick + 1, Math.round(n.end + rand() * j)) };
    });
    const rate = matchRate(importParsedMidi({ ...m, notes }, 'x.mid').score, xml);
    console.log(`ずらした場合：高さ ${(rate.pitch * 100).toFixed(1)}%、長さ ${(rate.duration * 100).toFixed(1)}%`);
    expect(rate.pitch).toBeGreaterThan(0.95);
    expect(rate.duration).toBeGreaterThan(0.85);
  });

  it('MusicXML に書き出して読み戻せる', () => {
    const back = importMusicXml(exportMusicXml(r.score)).score;
    expect(back.notes.filter((n) => n.heads.length).length).toBe(r.score.notes.filter((n) => n.heads.length).length);
  });

  it('調の推定：ハ長調の音階・イ短調の和声的短音階', () => {
    const scale = (ps: number[]) => ps.map((pitch) => ({ pitch, duration: 1 }));
    expect(estimateKey(scale([60, 62, 64, 65, 67, 69, 71, 72, 67, 60]))).toEqual({ fifths: 0, mode: 'major' });
    expect(estimateKey(scale([69, 71, 72, 74, 76, 77, 80, 81, 76, 69, 69]))).toEqual({ fifths: 0, mode: 'minor' });
  });
});
