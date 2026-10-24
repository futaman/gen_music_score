// 描画用 Worker の窓口。依頼は届いた順に処理する（古くなった結果を捨てるのは呼び出し側）。

import type { RenderRequest, RenderResponse } from './verovio.worker';

export type RenderResult = { svg: string; ms: number; error?: string };

export class Renderer {
  private worker = new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, (r: RenderResult) => void>();
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e: MessageEvent<RenderResponse>) => {
        const m = e.data;
        if (m.type === 'ready') resolve();
        else {
          this.pending.get(m.id)?.({ svg: m.svg, ms: m.ms, error: m.error });
          this.pending.delete(m.id);
        }
      };
    });
  }

  private lastOptions = '';

  /** options が前回と違えば、描画の前に Verovio の設定を変える */
  render(mei: string, options: Record<string, unknown>): Promise<RenderResult> {
    const o = JSON.stringify(options);
    if (o !== this.lastOptions) {
      this.lastOptions = o;
      this.post({ type: 'options', options });
    }
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'render', id, mei });
    });
  }

  dispose() {
    this.worker.terminate();
  }

  private post(m: RenderRequest) {
    this.worker.postMessage(m);
  }
}
