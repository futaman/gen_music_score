// 再生用の楽器サンプル（public/samples/<sample>/<音名>.mp3）を FluidR3_GM（MIT ライセンス）から作る。
// 必要なもの：fluidsynth、ffmpeg（libmp3lame）、FluidR3_GM.sf2（Debian/Ubuntu なら fluid-soundfont-gm）
// 使い方: node scripts/gen-samples.mjs [/usr/share/sounds/sf2/FluidR3_GM.sf2]
//
// 楽器定義（config/instruments.json）の sample ごとに、実用音域の少し外側まで長3度おきに1音ずつ作る。
// 再生時は間の音を Tone.Sampler が高さを変えて鳴らす。

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SF2 = process.argv[2] ?? '/usr/share/sounds/sf2/FluidR3_GM.sf2';
const OUT = 'public/samples';
const STEP = 4; // 長3度おき
const NOTE_SECONDS = 1.6;
const TOTAL_SECONDS = 2.2;

const { instruments } = JSON.parse(readFileSync('config/instruments.json', 'utf8'));
const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midiOf(text) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(text);
  return (Number(m[3]) + 1) * 12 + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const fileName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** 1音だけの MIDI ファイル（フォーマット0） */
function midiFile(program, note, seconds) {
  const tpq = 480; // 120bpm で 4分音符 = 0.5秒
  const ticks = Math.round((seconds / 0.5) * tpq);
  const vlq = (n) => {
    const bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  };
  const events = [0x00, 0xc0, program, 0x00, 0x90, note, 96, ...vlq(ticks), 0x80, note, 0, 0x00, 0xff, 0x2f, 0x00];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
  const len = events.length;
  const track = [
    0x4d,
    0x54,
    0x72,
    0x6b,
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...events,
  ];
  return Buffer.from([...header, ...track]);
}

const tmp = mkdtempSync(join(tmpdir(), 'samples-'));
const done = new Set();
const manifest = {};
let total = 0;
for (const inst of instruments) {
  if (inst.unpitched || inst.id === 'unknown' || done.has(inst.sample)) continue;
  done.add(inst.sample);
  // 同じサンプルを使う楽器（B♭・A・C管クラリネットなど）の音域をあわせる
  const group = instruments.filter((i) => i.sample === inst.sample && i.id !== 'unknown');
  const lo = Math.min(...group.map((i) => midiOf(i.range.practical[0])));
  const hi = Math.max(...group.map((i) => midiOf(i.range.practical[1])));
  const dir = join(OUT, inst.sample);
  mkdirSync(dir, { recursive: true });
  const notes = [];
  for (let n = lo - 2; n <= hi + STEP; n += STEP) notes.push(Math.max(12, Math.min(120, n)));
  manifest[inst.sample] = [];
  for (const note of notes) {
    const mid = join(tmp, `${inst.sample}-${note}.mid`);
    const wav = join(tmp, `${inst.sample}-${note}.wav`);
    const mp3 = join(dir, `${fileName(note)}.mp3`);
    writeFileSync(mid, midiFile(inst.midiProgram, note, NOTE_SECONDS));
    execFileSync('fluidsynth', ['-ni', '-q', '-g', '0.8', '-r', '44100', '-F', wav, SF2, mid], { stdio: 'ignore' });
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        wav,
        '-t',
        String(TOTAL_SECONDS),
        '-af',
        `afade=t=out:st=${TOTAL_SECONDS - 0.3}:d=0.3`,
        '-ac',
        '1',
        '-ar',
        '32000',
        '-b:a',
        '48k',
        mp3,
      ],
      { stdio: 'ignore' },
    );
    total += statSync(mp3).size;
    manifest[inst.sample].push(fileName(note));
  }
  console.log(`${inst.sample}: ${notes.length}音`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
writeFileSync(
  join(OUT, 'LICENSE.txt'),
  `These samples were rendered from the Fluid (R3) General MIDI SoundFont (FluidR3_GM.sf2)
by scripts/gen-samples.mjs.

FluidR3_GM.sf2: Copyright (c) 2000-2002, 2008 Frank Wen
"I hereby release Fluid under the MIT license, as described in COPYING."

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
`,
);
rmSync(tmp, { recursive: true, force: true });
console.log(`合計 ${(total / 1024 / 1024).toFixed(2)}MB`);
