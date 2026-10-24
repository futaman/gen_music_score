// Verovio を動かす Web Worker。チャンク（数小節分のMusicXML）を受け取ってSVGを返す。
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

export type WorkerRequest =
  | { type: 'init'; options: Record<string, unknown> }
  | { type: 'render'; reqId: number; chunk: number; xml: string }
  | { type: 'editPitch'; reqId: number; chunk: number; xml: string; noteId: string; pname: string; oct: number; measureId?: string };

export type WorkerResponse =
  | { type: 'ready'; ms: number; version: string }
  | { type: 'svg'; reqId: number; chunk: number; svg: string; ms: number; path: 'load' | 'fast' }
  // 小節だけを差し替えるとき：fragment は <g class="measure"> 1つ分、svgId はグリフ定義の接尾辞
  | { type: 'measure'; reqId: number; chunk: number; fragment: string; svgId: string; ms: number; path: 'fast' };

let tk: VerovioToolkit;
let loadedChunk = -1; // ツールキットに今読み込まれているチャンク

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const t = performance.now();
    tk = new VerovioToolkit(await createVerovioModule());
    tk.setOptions(msg.options);
    post({ type: 'ready', ms: performance.now() - t, version: tk.getVersion() });
    return;
  }
  const t = performance.now();
  if (msg.type === 'editPitch' && loadedChunk === msg.chunk) {
    // 音高だけの変更：再レイアウトせず、音の縦位置だけ計算し直す
    tk.edit({ action: 'set', param: { elementId: msg.noteId, attribute: 'pname', value: msg.pname } });
    tk.edit({ action: 'set', param: { elementId: msg.noteId, attribute: 'oct', value: String(msg.oct) } });
    tk.redoPagePitchPosLayout();
    const svg = tk.renderToSVG(1);
    const fragment = msg.measureId ? extractGroup(svg, msg.measureId) : null;
    if (fragment) {
      const svgId = svg.match(/<svg[^>]*\sid="([^"]+)"/)![1];
      post({ type: 'measure', reqId: msg.reqId, chunk: msg.chunk, fragment, svgId, ms: performance.now() - t, path: 'fast' });
    } else {
      post({ type: 'svg', reqId: msg.reqId, chunk: msg.chunk, svg, ms: performance.now() - t, path: 'fast' });
    }
    return;
  }
  tk.loadData(msg.xml);
  loadedChunk = msg.chunk;
  post({ type: 'svg', reqId: msg.reqId, chunk: msg.chunk, svg: tk.renderToSVG(1), ms: performance.now() - t, path: 'load' });
};

// SVG文字列から id の <g> 要素1つ分（入れ子の </g> を数えて閉じタグまで）を取り出す
function extractGroup(svg: string, id: string): string | null {
  const start = svg.indexOf(`<g id="${id}"`);
  if (start < 0) return null;
  const re = /<g[\s>]|<\/g>|<g\/>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    if (m[0] === '</g>') depth--;
    else if (!m[0].endsWith('/>')) depth++;
    if (depth === 0) return svg.slice(start, m.index + m[0].length);
  }
  return null;
}
