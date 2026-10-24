import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import fs from 'node:fs';
const tk = new VerovioToolkit(await createVerovioModule());
tk.setOptions({ pageWidth: 1400, adjustPageHeight: true, scale: 50, header: 'none', footer: 'none', breaks: 'auto' });
const out = process.argv[2];
const doc = (sd, body) =>
  `<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score>${sd}<section>${body}</section></score></mdiv></body></music></mei>`;
const sd = (meterVisible) =>
  `<scoreDef><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"><label>Cl.</label><keySig sig="2s"/><meterSig count="2" unit="4"${meterVisible ? '' : ' visible="false"'}/></staffDef><staffDef n="2" lines="5" clef.shape="F" clef.line="4"><label>Vc.</label><keySig sig="0"/><meterSig count="2" unit="4"${meterVisible ? '' : ' visible="false"'}/></staffDef></staffGrp></scoreDef>`;
const m1 = `<measure n="5"><staff n="1"><layer n="1"><note xml:id="a" pname="d" oct="5" dur="8"/><note xml:id="b" pname="e" oct="5" dur="8"/><tuplet num="3" numbase="2"><note xml:id="c" pname="f" oct="5" dur="8" accid.ges="s"/><note xml:id="d" pname="g" oct="5" dur="8"/><note xml:id="e" pname="a" oct="5" dur="8"/></tuplet></layer></staff><staff n="2"><layer n="1"><space dur="8"/><note xml:id="f" pname="c" oct="3" dur="8"/><note xml:id="g" pname="c" oct="3" dur="4" accid="s"/></layer><layer n="2"><note xml:id="h" pname="c" oct="2" dur="2"/></layer></staff><beamSpan startid="#a" endid="#b" plist="#a #b"/><beamSpan startid="#c" endid="#e" plist="#c #d #e"/><dynam staff="1" tstamp="1">mf</dynam><dir staff="1" tstamp="1.5" place="above">dolce</dir><tempo staff="1" tstamp="1" mm="108" mm.unit="4">Allegro</tempo><reh staff="1" tstamp="0">A</reh></measure>`;
const keyChange = `<scoreDef><staffGrp><staffDef n="1"><keySig sig="3f"/></staffDef><staffDef n="2"><keySig sig="1s"/></staffDef></staffGrp></scoreDef>`;
const m2 = `<measure n="6" right="end"><staff n="1"><layer n="1"><chord xml:id="ch" dur="4"><note xml:id="i" pname="e" oct="5"/><note xml:id="j" pname="g" oct="5"/></chord><bTrem><note xml:id="k" pname="b" oct="4" dur="4" stem.mod="3slash"/></bTrem></layer></staff><staff n="2"><layer n="1"><clef shape="C" line="4"/><mRest/></layer></staff><fermata startid="#k"/><hairpin form="cres" staff="1" tstamp="1" tstamp2="0m+2"/></measure>`;
for (const [name, xml] of [
  ['visible', doc(sd(true), m1 + keyChange + m2)],
  ['hidden', doc(sd(false), m1 + keyChange + m2)],
]) {
  tk.loadData(xml);
  const svg = tk.renderToSVG(1);
  fs.writeFileSync(`${out}/${name}.svg`, svg);
  console.log(
    name,
    [
      'beam',
      'tuplet',
      'dynam',
      'dir',
      'tempo',
      'reh',
      'meterSig',
      'keySig',
      'fermata',
      'hairpin',
      'bTrem',
      'clef',
      'mRest',
      'label',
    ]
      .map((c) => `${c}:${(svg.match(new RegExp(`class="${c}[" ]`, 'g')) ?? []).length}`)
      .join(' '),
  );
}
