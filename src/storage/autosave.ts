// 自動保存：編集が止まって3秒たったら端末へ保存する。画面を離れるときはすぐ保存する。

import type { Project, Score } from '../core/model/types';
import { saveScore } from './projects';

export const AUTOSAVE_DELAY = 3000;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export class AutoSaver {
  private project: Project;
  private pending: Score | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  state: SaveState = 'saved';
  error: string | null = null;
  private version = 0;

  constructor(
    project: Project,
    private deviceId: string,
    private delay = AUTOSAVE_DELAY,
  ) {
    this.project = project;
  }

  /** useSyncExternalStore 用 */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private set(state: SaveState, error: string | null = null) {
    this.state = state;
    this.error = error;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** 保存したものと、まだ保存していない編集を合わせた最新のプロジェクト */
  current(): Project {
    return this.pending ? { ...this.project, sourceScore: this.pending } : this.project;
  }

  schedule(score: Score) {
    if (score === this.project.sourceScore && !this.pending) return;
    this.pending = score;
    this.set('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** まだ保存していない編集があれば、今すぐ保存する */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const score = this.pending;
    if (!score) return this.chain;
    this.pending = null;
    this.set('saving');
    this.chain = this.chain.then(async () => {
      try {
        this.project = await saveScore(this.project, score, this.deviceId);
        if (!this.pending) this.set('saved');
      } catch (e) {
        // 次の編集でもう一度試す
        this.pending ??= score;
        this.set('error', e instanceof Error ? e.message : String(e));
      }
    });
    return this.chain;
  }
}

export function saveStateLabel(s: AutoSaver): string {
  switch (s.state) {
    case 'saved':
      return '端末に保存済み';
    case 'pending':
    case 'saving':
      return '保存中…';
    case 'error':
      return '端末に保存できませんでした';
  }
}
