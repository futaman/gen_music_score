// 再生中の表示：鳴っている音に色を付け、今の小節が見えるようにスクロールする。

import type { Timeline } from '../core/playback/timeline';

export class PlaybackCursor {
  private active: { id: string; end: number }[] = [];
  private next = 0;
  private lastPos = -1;
  private lastMeasure = -1;

  constructor(
    private timeline: Timeline,
    private containerRef: { current: HTMLElement | null },
  ) {}

  /** 今いる小節（演奏順の何番目か） */
  markAt(pos: number): number {
    const ms = this.timeline.measures;
    let lo = 0;
    let hi = ms.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ms[mid].time <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  update(pos: number, follow: boolean) {
    const root = this.containerRef.current;
    if (!root) return;
    const events = this.timeline.events;
    if (pos < this.lastPos) this.reset();
    this.lastPos = pos;
    while (this.next < events.length && events[this.next].time <= pos) {
      const e = events[this.next++];
      if (e.time + e.duration > pos) this.active.push({ id: e.headId, end: e.time + e.duration });
    }
    const still: typeof this.active = [];
    for (const a of this.active) {
      const el = root.querySelector(`[id="${a.id}"]`);
      if (a.end > pos) {
        el?.classList.add('playing');
        still.push(a);
      } else el?.classList.remove('playing');
    }
    this.active = still;

    const mark = this.timeline.measures[this.markAt(pos)];
    if (mark && mark.measure !== this.lastMeasure) {
      this.lastMeasure = mark.measure;
      if (follow) this.reveal(root, mark.measure);
    }
  }

  reset() {
    const root = this.containerRef.current;
    root?.querySelectorAll('.playing').forEach((el) => el.classList.remove('playing'));
    this.active = [];
    this.next = 0;
    this.lastPos = -1;
    this.lastMeasure = -1;
  }

  /** 小節が画面に入っていなければスクロールする（まだ描いていないチャンクも、その場所へ動かす） */
  private reveal(root: HTMLElement, measure: number) {
    const section = [...root.querySelectorAll<HTMLElement>('section.chunk')].find(
      (s) => Number(s.dataset.start) <= measure && measure < Number(s.dataset.end),
    );
    if (!section) return;
    const target = (section.querySelector(`[id="m${measure}"]`) as Element | null) ?? section;
    const r = target.getBoundingClientRect();
    const toolbar = document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0;
    const bar = document.querySelector('.playbar')?.getBoundingClientRect().top ?? innerHeight;
    const horizontal = root.classList.contains('layout-horizontal');
    const visible = horizontal ? r.left >= 0 && r.right <= root.clientWidth : r.top >= toolbar && r.bottom <= bar;
    if (!visible) target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'start' });
  }
}
