import { describe, expect, it } from 'vitest';
import { buildScoreIndex } from '../model/scoreIndex';
import type { MeasureMeta } from '../model/types';
import { importMusicXml } from '../musicxml/import';
import { buildTimeline, playOrder } from './timeline';

const m = (extra: Partial<MeasureMeta> = {}, i = 0): MeasureMeta => ({
  index: i,
  displayNumber: String(i + 1),
  ...extra,
});
const seq = (list: Partial<MeasureMeta>[]) => list.map((x, i) => m(x, i));

describe('演奏順（繰り返しの展開）', () => {
  it('繰り返しなし', () => expect(playOrder(seq([{}, {}, {}]))).toEqual([0, 1, 2]));
  it('|: 0 1 :| 2', () =>
    expect(playOrder(seq([{ repeat: 'start' }, { repeat: 'end' }, {}]))).toEqual([0, 1, 0, 1, 2]));
  it('始まりの記号がなければ曲頭へ戻る', () =>
    expect(playOrder(seq([{}, { repeat: 'end' }, {}]))).toEqual([0, 1, 0, 1, 2]));
  it('1番・2番括弧', () => {
    const ms = seq([
      { repeat: 'start' },
      {},
      { ending: { numbers: '1', type: 'start-stop' }, repeat: 'end' },
      { ending: { numbers: '2', type: 'start-stop' } },
      {},
    ]);
    expect(playOrder(ms)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });
  it('複数小節の1番括弧', () => {
    const ms = seq([
      {},
      { ending: { numbers: '1', type: 'start' } },
      { ending: { numbers: '1', type: 'stop' }, repeat: 'end' },
      { ending: { numbers: '2', type: 'discontinue' } },
    ]);
    expect(playOrder(ms)).toEqual([0, 1, 2, 0, 3]);
  });
  it('D.C. al Fine（戻ったあとは繰り返さない）', () => {
    const ms = seq([{ repeat: 'start' }, { repeat: 'end', jumps: ['fine'] }, {}, { jumps: ['dacapo'] }]);
    expect(playOrder(ms)).toEqual([0, 1, 0, 1, 2, 3, 0, 1]);
  });
  it('D.S. al Coda', () => {
    const ms = seq([{}, { jumps: ['segno'] }, { jumps: ['tocoda'] }, { jumps: ['dalsegno'] }, { jumps: ['coda'] }, {}]);
    expect(playOrder(ms)).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });
});

describe('再生イベント', () => {
  const xml = (
    body: string,
    tempo = '',
  ) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${tempo}${body}</part></score-partwise>`;
  const n = (step: string, dur: number, extra = '', notations = '') =>
    `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>${dur}</duration>${extra}<type>quarter</type>${notations ? `<notations>${notations}</notations>` : ''}</note>`;
  const tl = (x: string) => buildTimeline(buildScoreIndex(importMusicXml(x).score));

  it('テンポどおりの秒数（4分音符=120 → 1拍0.5秒）', () => {
    const t = tl(
      xml(
        `${n('C', 1)}${n('D', 1)}${n('E', 2)}</measure>`,
        '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>',
      ),
    );
    expect(t.events.map((e) => e.time)).toEqual([0, 0.5, 1]);
    expect(t.duration).toBeCloseTo(2);
  });
  it('タイは1つの長い音（短くしない）、スタッカートは半分', () => {
    const t = tl(
      xml(
        `${n('C', 2, '<tie type="start"/>')}${n('C', 2, '<tie type="stop"/>')}</measure><measure number="2">${n('D', 4, '', '<articulations><staccato/></articulations>')}</measure>`,
        '<sound tempo="60"/>',
      ),
    );
    expect(t.events.map((e) => [e.midi, e.time, Math.round(e.duration * 100) / 100])).toEqual([
      [72, 0, 4],
      [74, 4, 2],
    ]);
  });
  it('強弱で音量が変わる', () => {
    const dyn = (v: string) => `<direction><direction-type><dynamics><${v}/></dynamics></direction-type></direction>`;
    const t = tl(xml(`${dyn('p')}${n('C', 2)}${dyn('f')}${n('D', 2)}</measure>`));
    expect(t.events[0].velocity).toBeLessThan(t.events[1].velocity);
  });
  it('フェルマータはその音の長さの半分だけ止まる', () => {
    const t = tl(xml(`${n('C', 2, '', '<fermata/>')}${n('D', 2)}</measure>`, '<sound tempo="60"/>'));
    expect(t.events[1].time).toBeCloseTo(3);
  });
});
