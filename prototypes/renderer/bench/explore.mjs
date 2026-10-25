import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import fs from 'node:fs';
const M = await createVerovioModule();
const tk = new VerovioToolkit(M);
console.log('version', tk.getVersion());
let xml = fs.readFileSync('../../test-assets/musicxml/synthetic-orchestra-500.musicxml','utf8');
// 音符にidを付ける
let n=0; xml = xml.replace(/<note>/g, () => `<note id="n${n++}">`);
console.log('notes', n);
tk.setOptions({ pageWidth: 2100, pageHeight: 2970, scale: 40, breaks: 'auto', footer: 'none', header:'none' });
let t=performance.now(); tk.loadData(xml); console.log('loadData ms', (performance.now()-t)|0, 'pages', tk.getPageCount());
t=performance.now(); let svg = tk.renderToSVG(1); console.log('render p1 ms', (performance.now()-t)|0, 'svg KB', svg.length>>10);
const ids = [...svg.matchAll(/class="note" id="([^"]+)"|id="([^"]+)" class="note"/g)].slice(0,5).map(m=>m[1]||m[2]);
console.log('note ids p1', ids);
const svgNote = svg.match(/<g[^>]*class="note[^"]*"[^>]*>/); console.log(svgNote?.[0]);
// editor
const target = ids[0];
console.log('attrs', JSON.stringify(tk.getElementAttr(target)));
t=performance.now();
const ok = tk.edit({ action: 'set', param: { elementId: target, attrType: 'pname', attrValue: 'g' } });
console.log('edit set ok', ok, (performance.now()-t)|0,'ms');
t=performance.now(); tk.redoPagePitchPosLayout(); svg = tk.renderToSVG(1); console.log('redoPagePitchPos+render ms', (performance.now()-t)|0);
console.log('attrs after', JSON.stringify(tk.getElementAttr(target)));
t=performance.now(); tk.redoLayout(); console.log('redoLayout ms', (performance.now()-t)|0);
t=performance.now(); svg = tk.renderToSVG(1); console.log('render p1 ms', (performance.now()-t)|0);
// MusicXML全体再読み込み
t=performance.now(); tk.loadData(xml); tk.renderToSVG(1); console.log('full reload+render ms', (performance.now()-t)|0);
