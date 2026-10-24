import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
const tk = new VerovioToolkit(await createVerovioModule());
tk.loadData(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="x1"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);
console.log(tk.renderToSVG(1).slice(0, 3000));
