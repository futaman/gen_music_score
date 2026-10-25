// 性能テスト用の合成オーケストラスコアを生成する。
// 運命 第1楽章と同じ規模（2管編成・約500小節・2/4拍子・ハ短調）。音楽的な意味はない。
// 使い方: node scripts/gen-synthetic-orchestra.mjs [小節数] > test-assets/musicxml/synthetic-orchestra-500.musicxml

const MEASURES = Number(process.argv[2] ?? 500);
const DIVISIONS = 4; // 4分音符 = 4 → 16分音符 = 1

// [id, 名前, 音部記号, 最低音MIDI, 最高音MIDI, 移調(diatonic, chromatic) 記譜→実音]
const PARTS = [
  ['fl1', 'Flute 1', 'G2', 72, 91],
  ['fl2', 'Flute 2', 'G2', 67, 86],
  ['ob1', 'Oboe 1', 'G2', 67, 86],
  ['ob2', 'Oboe 2', 'G2', 62, 81],
  ['cl1', 'Clarinet in B♭ 1', 'G2', 60, 84, [-1, -2]],
  ['cl2', 'Clarinet in B♭ 2', 'G2', 55, 79, [-1, -2]],
  ['fg1', 'Bassoon 1', 'F4', 43, 65],
  ['fg2', 'Bassoon 2', 'F4', 36, 58],
  ['hn1', 'Horn in E♭ 1', 'G2', 55, 72, [-5, -9]],
  ['hn2', 'Horn in E♭ 2', 'G2', 48, 67, [-5, -9]],
  ['tp1', 'Trumpet in C 1', 'G2', 60, 79],
  ['tp2', 'Trumpet in C 2', 'G2', 55, 72],
  ['timp', 'Timpani', 'F4', 43, 55],
  ['vn1', 'Violin 1', 'G2', 67, 91],
  ['vn2', 'Violin 2', 'G2', 60, 84],
  ['va', 'Viola', 'C3', 53, 74],
  ['vc', 'Violoncello', 'F4', 36, 62],
  ['cb', 'Contrabass', 'F4', 28, 50, [-7, -12]],
];

let seed = 5;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rand() * a.length)];

// ハ短調の音階（実音）。変化音は♭で綴る
const SCALE_PC = [0, 2, 3, 5, 7, 8, 10, 11];
const NAMES = {
  0: ['C', 0],
  1: ['D', -1],
  2: ['D', 0],
  3: ['E', -1],
  4: ['E', 0],
  5: ['F', 0],
  6: ['G', -1],
  7: ['G', 0],
  8: ['A', -1],
  9: ['A', 0],
  10: ['B', -1],
  11: ['B', 0],
};

function spell(midi) {
  const [step, alter] = NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor((midi - alter) / 12) - 1;
  return { step, alter, octave };
}

function randomPitch(lo, hi) {
  for (;;) {
    const m = lo + Math.floor(rand() * (hi - lo + 1));
    if (SCALE_PC.includes(m % 12)) return m;
  }
}

// 音階の上を歩くように動かす（ほとんど2度・3度、ときどき4度・5度。音域の端では向きを変える）
const SCALE_MIDI = [];
for (let m = 0; m < 128; m++) if (SCALE_PC.includes(m % 12)) SCALE_MIDI.push(m);
function nextPitch(prev, lo, hi) {
  const i = SCALE_MIDI.indexOf(prev);
  const r = rand();
  let step = r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.92 ? 3 : 4;
  if (rand() < 0.5) step = -step;
  let j = i + step;
  if (SCALE_MIDI[j] > hi || SCALE_MIDI[j] < lo) j = i - step;
  return SCALE_MIDI[Math.max(0, Math.min(SCALE_MIDI.length - 1, j))];
}

// 1小節（2/4 = 8 divisions）のリズム型
const RHYTHMS = [[2, 2, 2, 2], [4, 4], [8], [2, 2, 4], [1, 1, 1, 1, 2, 2], [3, 1, 4]];
const TYPE = {
  1: ['16th', false],
  2: ['eighth', false],
  3: ['eighth', true],
  4: ['quarter', false],
  8: ['half', false],
};

function noteXml({ midi, dur, transpose, chord = false, tie, rest = false }) {
  const [type, dot] = TYPE[dur];
  let x = '<note>';
  if (chord) x += '<chord/>';
  if (rest) x += '<rest/>';
  else {
    const written = midi - (transpose ? transpose[1] : 0);
    const p = spell(written);
    x += `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
  }
  x += `<duration>${dur}</duration>`;
  if (tie) x += `<tie type="${tie}"/>`;
  x += `<voice>1</voice><type>${type}</type>${dot ? '<dot/>' : ''}`;
  // スタッカートは8分音符以下の短い音にだけ付ける
  const staccato = !rest && !tie && !chord && dur <= 2 && rand() < 0.25;
  if (tie || staccato) {
    x += '<notations>';
    if (tie) x += `<tied type="${tie}"/>`;
    if (staccato) x += '<articulations><staccato/></articulations>';
    x += '</notations>';
  }
  return x + '</note>';
}

const out = [];
out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
out.push(
  '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
);
out.push('<score-partwise version="4.0">');
out.push(`<work><work-title>Synthetic Orchestra ${MEASURES}</work-title></work>`);
out.push(
  '<identification><creator type="composer">gen-synthetic-orchestra.mjs</creator><encoding><software>gen-synthetic-orchestra.mjs</software></encoding></identification>',
);
out.push('<part-list>');
for (const [id, name] of PARTS) out.push(`<score-part id="${id}"><part-name>${name}</part-name></score-part>`);
out.push('</part-list>');

for (const [id, , clef, lo, hi, transpose] of PARTS) {
  out.push(`<part id="${id}">`);
  let restUntil = -1;
  let prev = SCALE_MIDI.find((m) => m >= Math.round((lo + hi) / 2));
  for (let m = 1; m <= MEASURES; m++) {
    let x = `<measure number="${m}">`;
    if (m === 1) {
      const [sign, line] = [clef[0], clef[1]];
      const fifths = transpose ? -3 - Math.round((transpose[1] * 7) % 12) : -3;
      x += `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${transpose ? normFifths(fifths) : -3}</fifths><mode>minor</mode></key>`;
      x += `<time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>${sign}</sign><line>${line}</line></clef>`;
      if (transpose)
        x += `<transpose><diatonic>${transpose[0]}</diatonic><chromatic>${transpose[1]}</chromatic></transpose>`;
      x += '</attributes>';
      x +=
        '<direction placement="above"><direction-type><words>Allegro con brio</words></direction-type><sound tempo="108"/></direction>';
    }
    if (m % 8 === 1 && rand() < 0.5) {
      x += `<direction placement="below"><direction-type><dynamics><${pick(['p', 'f', 'ff', 'mf'])}/></dynamics></direction-type></direction>`;
    }
    if (m > restUntil && rand() < 0.08) restUntil = m + Math.floor(rand() * 6);
    if (m <= restUntil) {
      x += '<note><rest measure="yes"/><duration>8</duration><voice>1</voice></note>';
    } else {
      const rhythm = pick(RHYTHMS);
      for (const dur of rhythm) {
        const midi = (prev = nextPitch(prev, lo, hi));
        x += noteXml({ midi, dur, transpose });
        // 弦と金管はときどき重音・和音
        if (['vn1', 'vn2', 'va', 'hn1'].includes(id) && rand() < 0.1 && midi - 4 >= lo) {
          x += noteXml({ midi: randomPitch(Math.max(lo, midi - 9), midi - 3), dur, transpose, chord: true });
        }
      }
    }
    if (m === MEASURES) x += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    x += '</measure>';
    out.push(x);
  }
  out.push('</part>');
}
out.push('</score-partwise>');
process.stdout.write(out.join('\n') + '\n');

function normFifths(f) {
  // 記譜調号を -7..7 に収める
  while (f > 7) f -= 12;
  while (f < -7) f += 12;
  return f;
}
