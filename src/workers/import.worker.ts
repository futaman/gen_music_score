// 楽譜ファイルの読み込みを画面の外（Web Worker）で行う。大きな楽譜でも画面が固まらないように。

import { ImportError } from '../core/musicxml/errors';
import { readScoreFile, type ImportResult } from '../core/musicxml/file';

export type ImportRequest = { bytes: Uint8Array; fileName: string };
export type ImportResponse =
  { ok: true; result: ImportResult; ms: number } | { ok: false; code: string; message: string };

self.onmessage = (e: MessageEvent<ImportRequest>) => {
  const t = performance.now();
  let res: ImportResponse;
  try {
    res = { ok: true, result: readScoreFile(e.data.bytes, e.data.fileName), ms: performance.now() - t };
  } catch (err) {
    res =
      err instanceof ImportError
        ? { ok: false, code: err.code, message: err.message }
        : { ok: false, code: 'internal', message: `読み込み中に問題が起きました：${String(err)}` };
  }
  (self as unknown as Worker).postMessage(res);
};
