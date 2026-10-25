// 自動保存：編集が止まって3秒たったら端末へ保存する。画面を離れるときはすぐ保存する。

import type { Project, Score } from '../core/model/types';
import { saveProject, scoreById, withScore } from './projects';

export const AUTOSAVE_DELAY = 3000;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export class AutoSaver {
  private project: Project;
  private pending: Project | null = null;
  /** 保存している途中の版（保存中の編集も、次の編集の土台にする） */
  private inflight: Project | null = null;
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
    return this.pending ?? this.inflight ?? this.project;
  }

  /** 楽譜の編集を保存の予定に入れる（元の楽譜か作った楽譜かは id で決まる） */
  schedule(score: Score) {
    const cur = this.current();
    if (scoreById(cur, score.id) === score) return;
    this.update(withScore(cur, score));
  }

  /** プロジェクト全体の変更（編曲の割当表など）を保存の予定に入れる */
  update(next: Project) {
    this.pending = next;
    this.set('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** まだ保存していない編集があれば、今すぐ保存する */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const next = this.pending;
    if (!next) return this.chain;
    this.pending = null;
    this.inflight = next;
    this.set('saving');
    this.chain = this.chain.then(async () => {
      try {
        this.project = await saveProject(next, this.project.revision, this.deviceId);
        this.inflight = null;
        if (!this.pending) this.set('saved');
      } catch (e) {
        // 次の編集でもう一度試す
        this.pending ??= next;
        this.inflight = null;
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
