// 区切りをまたぐタイ・スラー・ヘアピンを、Verovio がどう描くかを確かめる
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import fs from 'node:fs';
const tk = new VerovioToolkit(await createVerovioModule());
tk.setOptions({ pageWidth: 1200, adjustPageHeight: true, scale: 50, header: 'none', footer: 'none', breaks: 'none' });
const out = process.argv[2];
const count = (svg) => ({ tie: (svg.match(/class="tie"/g) ?? []).length, slur: (svg.match(/class="slur"/g) ?? []).length, hairpin: (svg.match(/class="hairpin"/g) ?? []).length });

const head = (n) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Fl</part-name></score-part></part-list><part id="P1"><measure number="${n}"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
// チャンクA：最後の音からタイ・スラー・クレッシェンドが始まり、次のチャンクで終わる
const xmlA = head(1) + `<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>`
  + `<direction><direction-type><wedge type="crescendo"/></direction-type></direction>`
  + `<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><tie type="start"/><type>quarter</type><notations><tied type="start"/><slur type="start" number="1"/></notations></note></measure></part></score-partwise>`;
// チャンクB：前のチャンクから来たタイ・スラー・クレッシェンドが終わる
const xmlB = head(2) + `<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/></notations></note>`
  + `<note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><notations><slur type="stop" number="1"/></notations></note>`
  + `<direction><direction-type><wedge type="stop"/></direction-type></direction></measure></part></score-partwise>`;
for (const [name, xml] of [['musicxml-A', xmlA], ['musicxml-B', xmlB]]) {
  tk.loadData(xml); const svg = tk.renderToSVG(1); fs.writeFileSync(`${out}/${name}.svg`, svg); console.log(name, JSON.stringify(count(svg)));
}
// MEI で、範囲外を指す tstamp2 / 小節頭 tstamp=0 を使う
const mei = (body, n) => `<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><music><body><mdiv><score><scoreDef meter.count="2" meter.unit="4" key.sig="0"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2" label="Fl"/></staffGrp></scoreDef><section><measure n="${n}">${body}</measure></section></score></mdiv></body></music></mei>`;
const meiA = mei(`<staff n="1"><layer n="1"><note xml:id="a1" dur="4" pname="c" oct="5"/><note xml:id="a2" dur="4" pname="e" oct="5"/></layer></staff>`
  + `<tie startid="#a2" tstamp2="1m+1"/><slur startid="#a2" tstamp2="1m+2"/><hairpin form="cres" staff="1" tstamp="1" tstamp2="1m+1"/>`, 1);
const meiB = mei(`<staff n="1"><layer n="1"><note xml:id="b1" dur="4" pname="e" oct="5"/><note xml:id="b2" dur="4" pname="g" oct="5"/></layer></staff>`
  + `<tie staff="1" tstamp="0" endid="#b1"/><slur staff="1" tstamp="0" endid="#b2"/><hairpin form="cres" staff="1" tstamp="0" tstamp2="0m+1"/>`, 2);
for (const [name, x] of [['mei-A', meiA], ['mei-B', meiB]]) {
  tk.loadData(x); const svg = tk.renderToSVG(1); fs.writeFileSync(`${out}/${name}.svg`, svg); console.log(name, JSON.stringify(count(svg)));
}
