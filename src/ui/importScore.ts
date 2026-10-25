import type { ImportRequest, ImportResponse } from '../workers/import.worker';

/** Web Worker で楽譜ファイルを読み込む */
export function importInWorker(bytes: Uint8Array, fileName: string): Promise<ImportResponse> {
  const worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<ImportResponse>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      resolve({ ok: false, code: 'internal', message: `読み込み中に問題が起きました：${e.message}` });
      worker.terminate();
    };
    worker.postMessage({ bytes, fileName } satisfies ImportRequest, [bytes.buffer]);
  });
}
