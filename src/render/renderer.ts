// 描画用 Worker の窓口。依頼は届いた順に処理する（古くなった結果を捨てるのは呼び出し側）。
// dispose したあとに使われたら Worker を作り直す（React の StrictMode は開発時に部品を作って捨ててから作り直すため）。

import type { RenderRequest, RenderResponse } from './verovio.worker';

export type RenderResult = { svg: string; ms: number; error?: string };

export class Renderer {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: RenderResult) => void>();
  private lastOptions = '';

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      const m = e.data;
      if (m.type !== 'svg') return;
      this.pending.get(m.id)?.({ svg: m.svg, ms: m.ms, error: m.error });
      this.pending.delete(m.id);
    };
    worker.onerror = (e) => {
      // Worker が落ちたら、待っている依頼をすべてエラーで返し、次の依頼で作り直す
      for (const [, resolve] of this.pending)
        resolve({ svg: '', ms: 0, error: `描画エンジンが止まりました：${e.message}` });
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
      this.lastOptions = '';
    };
    this.worker = worker;
    this.lastOptions = '';
    return worker;
  }

  /** options が前回と違えば、描画の前に Verovio の設定を変える */
  render(mei: string, options: Record<string, unknown>): Promise<RenderResult> {
    const worker = this.ensureWorker();
    const o = JSON.stringify(options);
    if (o !== this.lastOptions) {
      this.lastOptions = o;
      worker.postMessage({ type: 'options', options } satisfies RenderRequest);
    }
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ type: 'render', id, mei } satisfies RenderRequest);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.lastOptions = '';
    // 止めたときに待っていた依頼は、作り直した Worker で描き直してもらう必要があるので、空の結果は返さない
    this.pending.clear();
  }
}
