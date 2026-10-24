// 元に戻す／やり直し（100回まで）。楽譜は書き換えずに作り直すので、前の楽譜をそのまま積んでおく。

import type { Score } from '../model/types';

export type HistoryEntry = { score: Score; changed: number[] | 'all'; label: string };

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  constructor(private limit = 100) {}

  /** 編集の前の楽譜を積む（やり直しの列は消える） */
  push(entry: HistoryEntry) {
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** 1つ戻す。current は今の楽譜（やり直し用に積む） */
  undo(current: Score): HistoryEntry | undefined {
    const e = this.past.pop();
    if (e) this.future.push({ ...e, score: current });
    return e;
  }

  redo(current: Score): HistoryEntry | undefined {
    const e = this.future.pop();
    if (e) this.past.push({ ...e, score: current });
    return e;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past[this.past.length - 1]?.label;
  }
  get redoLabel() {
    return this.future[this.future.length - 1]?.label;
  }
}
