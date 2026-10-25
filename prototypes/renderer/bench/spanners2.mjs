// 区切りの前側：終わりを同じ小節の小節線（拍子の拍数+1）に指定して描けるか
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import fs from 'node:fs';
const tk = new VerovioToolkit(await createVerovioModule());
tk.setOptions({ pageWidth: 1200, adjustPageHeight: true, scale: 50, header: 'none', footer: 'none', breaks: 'none' });
const mei = (body) => `<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef meter.count="2" meter.unit="4" key.sig="0"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2" label="Fl"/></staffGrp></scoreDef><section><measure n="1">${body}</measure></section></score></mdiv></body></music></mei>`;
const notes = `<staff n="1"><layer n="1"><note xml:id="a1" dur="4" pname="c" oct="5"/><note xml:id="a2" dur="4" pname="e" oct="5"/></layer></staff>`;
for (const t2 of ['0m+3', '0m+2.99']) {
  tk.loadData(mei(notes + `<tie startid="#a2" tstamp2="${t2}"/><slur startid="#a2" tstamp2="${t2}"/><hairpin form="cres" staff="1" tstamp="1" tstamp2="${t2}"/>`));
  const svg = tk.renderToSVG(1);
  fs.writeFileSync(`${process.argv[2]}/mei-A-${t2}.svg`, svg);
  console.log(t2, (svg.match(/class="(tie|slur|hairpin)">/g) ?? []).join(' '));
}
