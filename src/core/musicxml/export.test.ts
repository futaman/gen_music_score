import { describe, expect, it } from 'vitest';
import { exportMusicXml } from './export';
import { importMusicXml } from './import';

const wrap = (
  measures: string,
  fifths = 0,
) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${measures}</part></score-partwise>`;
const n = (step: string, alter = 0, extra = '') =>
  `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>4</octave></pitch><duration>1</duration>${extra}<type>quarter</type></note>`;
const accidentals = (xml: string) =>
  [...exportMusicXml(importMusicXml(xml).score).matchAll(/<accidental[^>]*>([^<]+)</g)].map((m) => m[1]);

describe('臨時記号の付け方', () => {
  it('調号にない変化に付け、同じ小節の2回目には付けず、戻すときにナチュラル', () => {
    expect(accidentals(wrap(`${n('F', 1)}${n('F', 1)}${n('F')}${n('C')}</measure>`))).toEqual(['sharp', 'natural']);
  });
  it('調号の音には付けない（ト長調の F♯）', () => {
    expect(accidentals(wrap(`${n('F', 1)}${n('F')}${n('G')}${n('G')}</measure>`, 1))).toEqual(['natural']);
  });
  it('小節が変わると付け直す。注意臨時記号は残す', () => {
    const m2 = `<measure number="2">${n('F', 1)}${n('F', 1, '<accidental cautionary="yes">sharp</accidental>')}${n('C')}${n('C')}</measure>`;
    const out = exportMusicXml(importMusicXml(wrap(`${n('F', 1)}${n('C')}${n('C')}${n('C')}</measure>${m2}`)).score);
    expect([...out.matchAll(/<accidental([^>]*)>([^<]+)</g)].map((m) => m[2] + m[1])).toEqual([
      'sharp',
      'sharp',
      'sharp cautionary="yes"',
    ]);
  });
});

describe('書き出しの形', () => {
  it('改行と字下げが入る（MuseScore 3.2 の読み落とし対策）', () => {
    const out = exportMusicXml(importMusicXml(wrap(`${n('C')}${n('D')}${n('E')}${n('F')}</measure>`)).score);
    expect(out).toContain('\n      <note>\n        <pitch>\n          <step>C</step>');
  });
});
