// 標準MIDIファイル（SMF、形式0・1）を読む。音・テンポ・拍子・調号・トラック名・音色だけを取り出す。

import { ImportError } from '../musicxml/errors';

export type MidiNote = { track: number; channel: number; tick: number; end: number; pitch: number; velocity: number };
export type MidiFile = {
  /** 4分音符あたりの tick 数 */
  division: number;
  notes: MidiNote[];
  tempos: { tick: number; usPerQuarter: number }[];
  timeSigs: { tick: number; beats: number; beatType: number }[];
  keySigs: { tick: number; fifths: number; minor: boolean }[];
  /** トラック番号 → 名前 */
  trackNames: Map<number, string>;
  /** トラック番号|チャンネル → 最初の音色（GM のプログラム番号 0〜127） */
  programs: Map<string, number>;
};

export function isMidi(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64; // "MThd"
}

export function parseMidi(bytes: Uint8Array): MidiFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const broken = () => new ImportError('broken', 'MIDIファイルが壊れているか、途中で切れています。');
  if (!isMidi(bytes) || bytes.length < 14) throw broken();
  const headerLen = view.getUint32(4);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new ImportError('unsupported-format', 'SMPTE 時間のMIDIファイルには対応していません。');

  const out: MidiFile = {
    division,
    notes: [],
    tempos: [],
    timeSigs: [],
    keySigs: [],
    trackNames: new Map(),
    programs: new Map(),
  };
  let pos = 8 + headerLen;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  for (let t = 0; t < trackCount && pos + 8 <= bytes.length; t++) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4));
    const len = view.getUint32(pos + 4);
    pos += 8;
    const end = Math.min(bytes.length, pos + len);
    if (id !== 'MTrk') {
      pos = end;
      continue;
    }
    let p = pos;
    let tick = 0;
    let status = 0;
    const open = new Map<string, { tick: number; velocity: number }[]>();
    const varlen = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= end) throw broken();
        const b = bytes[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    while (p < end) {
      tick += varlen();
      let b = bytes[p];
      if (b & 0x80) {
        status = b;
        p++;
      } else if (!status) throw broken();
      b = status;
      if (b === 0xff) {
        const type = bytes[p++];
        const l = varlen();
        const data = bytes.subarray(p, p + l);
        p += l;
        if (type === 0x2f) break;
        if (type === 0x51 && l === 3)
          out.tempos.push({ tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (type === 0x58 && l >= 2) out.timeSigs.push({ tick, beats: data[0], beatType: 2 ** data[1] });
        else if (type === 0x59 && l === 2)
          out.keySigs.push({ tick, fifths: data[0] > 127 ? data[0] - 256 : data[0], minor: data[1] === 1 });
        else if (type === 0x03 && !out.trackNames.has(t)) out.trackNames.set(t, decoder.decode(data).trim());
        // 0xff の後は running status を使わない
        status = 0;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        p += varlen();
        status = 0;
        continue;
      }
      const type = b & 0xf0;
      const ch = b & 0x0f;
      const d1 = bytes[p++];
      const d2 = type === 0xc0 || type === 0xd0 ? 0 : bytes[p++];
      if (type === 0x90 && d2 > 0) {
        const k = `${ch}|${d1}`;
        open.set(k, [...(open.get(k) ?? []), { tick, velocity: d2 }]);
      } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        const k = `${ch}|${d1}`;
        const started = open.get(k)?.shift();
        if (started && tick > started.tick)
          out.notes.push({
            track: t,
            channel: ch,
            tick: started.tick,
            end: tick,
            pitch: d1,
            velocity: started.velocity,
          });
      } else if (type === 0xc0) {
        const k = `${t}|${ch}`;
        if (!out.programs.has(k)) out.programs.set(k, d1);
      }
    }
    pos = end;
  }
  out.notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  out.tempos.sort((a, b) => a.tick - b.tick);
  out.timeSigs.sort((a, b) => a.tick - b.tick);
  out.keySigs.sort((a, b) => a.tick - b.tick);
  return out;
}
