// Verovio（楽譜の描画）を動かす Web Worker。MEI を受け取って SVG を返す。

import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

export type RenderRequest =
  | { type: 'options'; options: Record<string, unknown> }
  | { type: 'render'; id: number; mei: string; allPages?: boolean };

export type RenderResponse =
  { type: 'ready' } | { type: 'svg'; id: number; svg: string; pages?: string[]; ms: number; error?: string };

let tk: VerovioToolkit | undefined;
const queue: RenderRequest[] = [];
let options: Record<string, unknown> = {};

const post = (m: RenderResponse) => (self as unknown as Worker).postMessage(m);

createVerovioModule().then((module) => {
  tk = new VerovioToolkit(module);
  tk.setOptions(options);
  post({ type: 'ready' });
  for (const m of queue.splice(0)) handle(m);
});

function handle(m: RenderRequest) {
  if (!tk) {
    queue.push(m);
    return;
  }
  if (m.type === 'options') {
    options = m.options;
    tk.setOptions(options);
    return;
  }
  const t = performance.now();
  try {
    tk.loadData(m.mei);
    const svg = tk.renderToSVG(1);
    // 印刷用：全ページを描く
    const pages = m.allPages
      ? [svg, ...Array.from({ length: tk.getPageCount() - 1 }, (_, i) => tk!.renderToSVG(i + 2))]
      : undefined;
    post({ type: 'svg', id: m.id, svg, pages, ms: performance.now() - t });
  } catch (e) {
    post({ type: 'svg', id: m.id, svg: '', ms: performance.now() - t, error: String(e) });
  }
}

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  if (e.data.type === 'options') options = e.data.options;
  handle(e.data);
};
