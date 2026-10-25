import { readFileSync } from 'node:fs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScoreIndex } from '../model/scoreIndex';
import { readScoreFile } from '../musicxml/file';
import { importMusicXml } from '../musicxml/import';
import { chunkSize, chunkToMei, staffLayout } from './chunk';

let tk: VerovioToolkit;
beforeAll(async () => {
  tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions({
    pageWidth: 2000,
    pageHeight: 60000,
    adjustPageHeight: true,
    breaks: 'auto',
    header: 'none',
    footer: 'none',
  });
});

const load = (name: string) =>
  readScoreFile(new Uint8Array(readFileSync(new URL(`../../../test-assets/musicxml/${name}`, import.meta.url))), name)
    .score;

/** チャンクを Verovio に読ませ、SVG と警告を返す */
function render(mei: string) {
  const logs: string[] = [];
  const ok = tk.loadData(mei);
  const log = tk.getLog();
  if (log) logs.push(log);
  return { ok, svg: ok ? tk.renderToSVG(1) : '', log: logs.join('\n') };
}

describe('MEI のチャンク', () => {
  it('段数に応じたチャンクの大きさ', () => {
    expect(chunkSize(4)).toBe(9);
    expect(chunkSize(5)).toBe(7);
    expect(chunkSize(18)).toBe(2);
    expect(chunkSize(1)).toBe(16);
  });

  it.each(['mozart-k464-1-allegro.mxl', 'beethoven-op18-1.mxl', 'synthetic-orchestra-500.musicxml'])(
    '%s の全チャンクが Verovio で描け、音符がすべて SVG に出る',
    (name) => {
      const score = load(name);
      const index = buildScoreIndex(score);
      const partIds = score.parts.map((p) => p.id);
      const size = chunkSize(staffLayout(index, partIds).length);
      let drawn = 0;
      let expected = 0;
      const problems: string[] = [];
      for (let start = 0; start < score.measures.length; start += size) {
        const end = Math.min(score.measures.length, start + size);
        const mei = chunkToMei(index, { start, end, partIds, pitchMode: 'written', labels: start ? 'abbr' : 'full' });
        const r = render(mei);
        if (!r.ok) problems.push(`${start}: 読み込めない`);
        const errors = r.log.split('\n').filter((l) => /\[Error\]/.test(l));
        if (errors.length) problems.push(`${start}: ${errors.slice(0, 3).join(' / ')}`);
        drawn += (r.svg.match(/class="note[" ]/g) ?? []).length;
        expected += score.notes
          .filter((n) => n.measure >= start && n.measure < end)
          .reduce((s, n) => s + n.heads.length, 0);
      }
      expect(problems.slice(0, 5)).toEqual([]);
      expect(drawn).toBe(expected);
    },
    120_000,
  );
});

describe('表示の切り替え', () => {
  const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinet in B♭</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>5</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
  <note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  const index = buildScoreIndex(importMusicXml(xml).score);
  const opts = { start: 0, end: 1, partIds: ['P1'], labels: 'full' as const };

  it('移調（記譜音）では Bメジャー・B、実音では Aメジャー・A', () => {
    const written = chunkToMei(index, { ...opts, pitchMode: 'written' });
    expect(written).toContain('<keySig sig="5s"/>');
    expect(written).toMatch(/pname="b" oct="4"/);
    const concert = chunkToMei(index, { ...opts, pitchMode: 'concert' });
    expect(concert).toContain('<keySig sig="3s"/>');
    expect(concert).toMatch(/pname="a" oct="4"/);
  });
});

describe('複数小節休符', () => {
  const rest = '<note><rest measure="yes"/><duration>4</duration></note>';
  const note = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>';
  const measures = [
    `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note}`,
    rest,
    rest,
    rest,
    rest,
    `<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>${rest}`,
    rest,
    rest,
    note,
  ];
  const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
  <part id="P1">${measures.map((m, i) => `<measure number="${i + 1}">${m}</measure>`).join('')}</part></score-partwise>`;
  const index = buildScoreIndex(importMusicXml(xml).score);
  const opts = { start: 0, end: 9, partIds: ['P1'], pitchMode: 'written' as const, labels: 'full' as const };

  it('続く全休符を数字付きの1つにまとめ、練習番号のある小節で切る。オフならまとめない', () => {
    const mei = chunkToMei(index, { ...opts, multiRest: true });
    expect([...mei.matchAll(/<multiRest num="(\d+)"/g)].map((m) => m[1])).toEqual(['4', '2']);
    expect([...mei.matchAll(/<measure [^>]*xml:id="m(\d+)"/g)].map((m) => m[1])).toEqual(['0', '1', '5', '6', '8']);
    const r = render(mei);
    expect(r.ok).toBeTruthy();
    expect(r.svg).toContain('class="multiRest');
    expect(chunkToMei(index, opts)).not.toContain('multiRest');
  });
});
