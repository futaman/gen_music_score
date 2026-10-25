import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { frac } from '../theory/fraction';
import { formatPitch } from '../theory/pitch';
import { ImportError } from './errors';
import { exportMusicXml } from './export';
import { decodeScoreFile, readScoreFile } from './file';
import { importMusicXml } from './import';

/** 1パートの小さな MusicXML を作る */
function score(measures: string, opts: { part?: string; attrs?: string } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>テスト &amp; 曲</work-title></work>
  <part-list>${opts.part ?? '<score-part id="P1"><part-name>Flute</part-name></score-part>'}</part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}
const ATTR = (extra = '') =>
  `<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${extra}</attributes>`;
const N = (step: string, oct: number, dur: number, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;

describe('MusicXMLの読み込み', () => {
  it('曲名（実体参照を戻す）・音高・長さ', () => {
    const r = importMusicXml(score(`<measure number="1">${ATTR()}${N('C', 5, 2)}${N('D', 5, 6)}</measure>`));
    expect(r.score.title).toBe('テスト & 曲');
    expect(r.score.notes.map((n) => formatPitch(n.heads[0].pitch))).toEqual(['C5', 'D5']);
    expect(r.score.notes[1].onset).toEqual(frac(1, 4));
    expect(r.score.notes[1].duration).toEqual(frac(3, 4));
    expect(r.score.measures[0].time).toEqual({ beats: 4, beatType: 4 });
    expect(r.warnings).toEqual([]);
  });

  it('和音と、和音の一部だけのタイ', () => {
    const m1 = `<measure number="1">${ATTR()}${N('C', 4, 8, '<tie type="start"/>')}${N('E', 4, 8, '<chord/>')}</measure>`;
    const m2 = `<measure number="2">${N('C', 4, 8, '<tie type="stop"/>')}${N('E', 4, 8, '<chord/>')}</measure>`;
    const r = importMusicXml(score(m1 + m2));
    expect(r.score.notes).toHaveLength(2);
    expect(r.score.notes[0].heads.map((h) => h.tie)).toEqual([{ start: true }, undefined]);
    expect(r.score.notes[1].heads.map((h) => h.tie)).toEqual([{ stop: true }, undefined]);
  });

  it('3連符（連符のまとまり）', () => {
    const tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
    const t = (type: string, extra = '') =>
      `<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type>${tm}${extra ? `<notations><tuplet type="${type}"/></notations>` : ''}</note>`;
    const xml = score(
      `<measure number="1"><attributes><divisions>3</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>${t('start', 'x')}${t('')}${t('stop', 'x')}</measure>`,
    );
    const notes = importMusicXml(xml).score.notes;
    expect(notes.map((n) => n.duration)).toEqual([frac(1, 6), frac(1, 6), frac(1, 6)]);
    expect(notes[0].tuplets?.[0]).toMatchObject({ actual: 3, normal: 2, start: true });
    expect(notes[1].tuplets?.[0].start).toBeUndefined();
    expect(notes[2].tuplets?.[0]).toMatchObject({ stop: true });
    expect(new Set(notes.map((n) => n.tuplets![0].id)).size).toBe(1);
  });

  it('装飾音は拍に数えない', () => {
    const grace = '<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>';
    const r = importMusicXml(score(`<measure number="1">${ATTR()}${grace}${N('C', 5, 8)}</measure>`));
    expect(r.score.notes[0].grace).toEqual({ slash: true });
    expect(r.score.notes[1].onset).toEqual(frac(0));
    expect(r.warnings).toEqual([]);
  });

  it('B♭クラリネット：記譜音を実音に直し、調号も実音にする', () => {
    const part =
      '<score-part id="P1"><part-name>Clarinet in B♭</part-name><score-instrument id="I1"><instrument-name>Clarinet</instrument-name><instrument-sound>wind.reed.clarinet.bflat</instrument-sound></score-instrument></score-part>';
    const attrs = `<attributes><divisions>1</divisions><key><fifths>5</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>`;
    const r = importMusicXml(score(`<measure number="1">${attrs}${N('B', 4, 4)}</measure>`, { part }));
    expect(r.score.parts[0].instrumentId).toBe('clarinet-bb');
    expect(r.score.parts[0].transposition).toBeUndefined(); // 楽器定義と同じなので持たない
    expect(formatPitch(r.score.notes[0].heads[0].pitch)).toBe('A4');
    expect(r.score.measures[0].key).toEqual({ fifths: 3, mode: 'major' }); // 記譜 Bメジャー → 実音 Aメジャー
    // 書き出すと記譜音・記譜の調号に戻る
    const xml = exportMusicXml(r.score);
    expect(xml).toContain('<fifths>5</fifths>');
    expect(xml).toMatch(/<step>B<\/step>\s*<octave>4<\/octave>/);
    expect(xml).toMatch(/<diatonic>-1<\/diatonic>\s*<chromatic>-2<\/chromatic>/);
  });

  it('E♭管ホルン（楽器定義と違う移調は Part に持つ）', () => {
    const part = '<score-part id="P1"><part-name>Horn in E♭</part-name></score-part>';
    const attrs = `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><transpose><diatonic>-5</diatonic><chromatic>-9</chromatic></transpose></attributes>`;
    const r = importMusicXml(score(`<measure number="1">${attrs}${N('C', 5, 4)}</measure>`, { part }));
    expect(r.score.parts[0].instrumentId).toBe('horn-f');
    expect(r.score.parts[0].transposition).toEqual({ diatonic: -5, chromatic: -9 });
    expect(formatPitch(r.score.notes[0].heads[0].pitch)).toBe('E♭4');
    expect(r.score.measures[0].key?.fifths).toBe(-3);
  });

  it('声部（backup）と小節途中の音部記号', () => {
    const v2 = `<backup><duration>8</duration></backup>${N('C', 4, 8, '<voice>2</voice>')}`;
    const clef = `<attributes><clef><sign>F</sign><line>4</line></clef></attributes>`;
    const r = importMusicXml(
      score(`<measure number="1">${ATTR()}${N('E', 5, 4)}${clef}${N('C', 3, 4)}${v2}</measure>`),
    );
    const v = r.score.notes.find((n) => n.voice === 2)!;
    expect(v.onset).toEqual(frac(0));
    expect(r.score.clefs.map((c) => `${c.sign}${c.line}@${c.onset.num}/${c.onset.den}`)).toEqual(['G2@0/1', 'F4@1/2']);
  });

  it('強弱・ヘアピン（終わりが先に書かれていても対応づける）・テンポ・練習番号', () => {
    const dir = (inner: string, attrs = '') =>
      `<direction${attrs}><direction-type>${inner}</direction-type></direction>`;
    const m = `<measure number="1">${ATTR()}${dir('<words>Allegro</words>')}${dir('<metronome><beat-unit>half</beat-unit><per-minute>80</per-minute></metronome>')}${dir('<rehearsal>A</rehearsal>')}${dir('<dynamics><mf/></dynamics>')}${N('C', 5, 4)}${dir('<wedge type="stop" number="2"/>')}${N('D', 5, 4)}<backup><duration>8</duration></backup><forward><duration>2</duration></forward>${dir('<wedge type="crescendo" number="2"/>')}<forward><duration>6</duration></forward></measure>`;
    const r = importMusicXml(score(m));
    expect(r.score.measures[0].rehearsal).toBe('A');
    expect(r.score.directions.find((d) => d.kind === 'dynamic')?.value).toBe('mf');
    const wedge = r.score.directions.find((d) => d.kind === 'wedge')!;
    expect(wedge.onset).toEqual(frac(1, 4));
    expect(wedge.end).toEqual({ measure: 0, onset: frac(1, 2) });
    expect(r.warnings).toEqual([]);
    // Allegro と メトロノームが別の direction のときは、Allegro は文字・テンポは小節のテンポ
    expect(r.score.measures[0].tempo).toMatchObject({ bpm: 80, beatUnit: frac(1, 2), metronomeShown: true });
  });

  it('繰り返し・括弧・D.C.', () => {
    const bar = (loc: string, inner: string) => `<barline location="${loc}">${inner}</barline>`;
    const m1 = `<measure number="1">${ATTR()}${bar('left', '<repeat direction="forward"/>')}${N('C', 5, 8)}</measure>`;
    const m2 = `<measure number="2">${bar('left', '<ending number="1" type="start"/>')}${N('C', 5, 8)}${bar('right', '<bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/>')}</measure>`;
    const m3 = `<measure number="3">${N('C', 5, 8)}<sound dacapo="yes"/></measure>`;
    const r = importMusicXml(score(m1 + m2 + m3));
    expect(r.score.measures.map((m) => [m.repeat, m.ending?.type, m.jumps])).toEqual([
      ['start', undefined, undefined],
      ['end', 'start-stop', undefined],
      [undefined, undefined, ['dacapo']],
    ]);
  });

  it('拍が合わない小節は警告して読み込みを続ける', () => {
    const r = importMusicXml(
      score(`<measure number="1">${ATTR()}${N('C', 5, 2)}</measure><measure number="2">${N('C', 5, 12)}</measure>`),
    );
    expect(r.warnings.map((w) => w.code)).toEqual(['measure-length']);
    expect(r.score.notes).toHaveLength(2);
  });

  it('対応していない要素は一覧に出して読み込みを続ける', () => {
    const r = importMusicXml(
      score(
        `<measure number="1">${ATTR()}<print new-page="yes"/>${N('C', 5, 8, '<notations><glissando type="start"/><foo/></notations>')}</measure>`,
      ),
    );
    expect(r.ignored).toEqual([
      { name: 'foo', count: 1, expected: false },
      { name: 'print', count: 1, expected: true },
    ]);
    expect(r.score.notes[0].passthrough?.notations?.[0].tag).toBe('glissando');
  });

  it('全休符', () => {
    const r = importMusicXml(
      score(
        `<measure number="1">${ATTR()}<note><rest measure="yes"/><duration>8</duration><voice>1</voice></note></measure>`,
      ),
    );
    expect(r.score.notes[0]).toMatchObject({ heads: [], measureRest: true, duration: frac(1) });
  });
});

describe('読み込めないファイル', () => {
  const code = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return e instanceof ImportError ? e.code : String(e);
    }
    return 'no error';
  };
  it('形式・壊れ・大きさ', () => {
    expect(code(() => decodeScoreFile(strToU8('MThd....'), 'a.mid'))).toBe('unsupported-format');
    expect(code(() => decodeScoreFile(strToU8('%PDF-1.4'), 'a.pdf'))).toBe('unsupported-format');
    expect(code(() => decodeScoreFile(strToU8('<html></html>'), 'a.xml'))).toBe('unsupported-format');
    expect(code(() => importMusicXml('<score-timewise version="3.0"></score-timewise>'))).toBe('timewise');
    expect(code(() => importMusicXml('<score-partwise><part-list></part-list></score-partwise>'))).toBe('empty');
    expect(code(() => decodeScoreFile(new Uint8Array(21 * 1024 * 1024), 'big.musicxml'))).toBe('too-large');
    expect(code(() => decodeScoreFile(strToU8('PK\u0003\u0004broken'), 'a.mxl'))).toBe('broken');
    const mscz = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="a.mscx"/></rootfiles></container>'),
      'a.mscx': strToU8('<museScore/>'),
    });
    expect(code(() => decodeScoreFile(mscz, 'a.mscz'))).toBe('musescore-file');
  });
  it('.mxl（container.xml の rootfile を読む）と UTF-16', () => {
    const xml = score(`<measure number="1">${ATTR()}${N('C', 5, 8)}</measure>`);
    const mxl = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="score/x.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      'score/x.musicxml': strToU8(xml),
    });
    expect(readScoreFile(mxl, 'x.mxl').score.notes).toHaveLength(1);
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...xml].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]),
    ]);
    expect(readScoreFile(utf16, 'x.musicxml').score.title).toBe('テスト & 曲');
  });
});
