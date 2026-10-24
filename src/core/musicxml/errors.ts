// 読み込みのエラー・警告。メッセージは画面にそのまま出すので日本語で書く。

export type ImportErrorCode = 'too-large' | 'unsupported-format' | 'musescore-file' | 'broken' | 'timewise' | 'empty';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ImportWarning = {
  code:
    | 'measure-count'
    | 'measure-length'
    | 'key-mismatch'
    | 'time-mismatch'
    | 'alter-overflow'
    | 'microtone'
    | 'unmatched-slur'
    | 'unmatched-wedge'
    | 'unmatched-tie'
    | 'transpose-change'
    | 'chord-without-note'
    | 'compound-time'
    | 'other';
  message: string;
  partId?: string;
  measure?: number; // 小節index
};

/** 無視した要素（読み込みは続ける）。expected は仕様で「無視」と決めている要素 */
export type IgnoredElement = { name: string; count: number; expected: boolean };

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
