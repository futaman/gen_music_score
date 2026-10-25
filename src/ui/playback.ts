// 再生中の表示：鳴っている音に色を付け、今の位置に縦線（カーソル）を出し、今の小節が見えるようにスクロールする。

import type { Timeline } from '../core/playback/timeline';

export class PlaybackCursor {
  private active: { id: string; end: number }[] = [];
  private next = 0;
  private lastPos = -1;
  private lastMeasure = -1;
  private line: HTMLDivElement | null = null;
  /** 音の鳴り始め（重複なし、時刻順）と、その時刻に鳴り始める音の id */
  private onsets: { time: number; ids: string[] }[] = [];

  constructor(
    private timeline: Timeline,
    private containerRef: { current: HTMLElement | null },
  ) {
    for (const e of timeline.events) {
      const last = this.onsets[this.onsets.length - 1];
      if (last && Math.abs(last.time - e.time) < 1e-6) last.ids.push(e.headId);
      else this.onsets.push({ time: e.time, ids: [e.headId] });
    }
  }

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
    if (mark) this.moveLine(root, pos, mark);
    if (mark && mark.measure !== this.lastMeasure) {
      this.lastMeasure = mark.measure;
      if (follow) this.reveal(root, mark.measure);
    }
  }

  reset() {
    const root = this.containerRef.current;
    root?.querySelectorAll('.playing').forEach((el) => el.classList.remove('playing'));
    this.line?.remove();
    this.line = null;
    this.active = [];
    this.next = 0;
    this.lastPos = -1;
    this.lastMeasure = -1;
  }

  /**
   * 縦線を今の位置へ。鳴り始めた音が画面にあればその音の左に、
   * なければ（休符や表示していないパートの音）小節の中を時間の割合で進める
   */
  private moveLine(root: HTMLElement, pos: number, mark: Timeline['measures'][number]) {
    // まとめた全休符の中なら、その休符の小節を使い、まとめた小節数の中での割合で進める
    let measure = root.querySelector(`[id="m${mark.measure}"]`);
    let runStart = mark.measure;
    let runLength = 1;
    if (!measure) {
      for (let k = mark.measure - 1; k >= Math.max(0, mark.measure - 1000) && !measure; k--) {
        const el = root.querySelector(`[id="m${k}"]`);
        if (el?.querySelector('.multiRest')) {
          measure = el;
          runStart = k;
          const section = el.closest<HTMLElement>('section.chunk');
          let next = k + 1;
          const end = Number(section?.dataset.end ?? k + 1);
          while (next < end && !section?.querySelector(`[id="m${next}"]`)) next++;
          runLength = next - k;
        } else if (el) break;
      }
    }
    const lines = measure ? [...measure.querySelectorAll('g.staff > path')] : [];
    if (!measure || lines.length === 0) {
      if (this.line) this.line.style.display = 'none';
      return;
    }
    const boxes = lines.map((l) => l.getBoundingClientRect());
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));

    let x: number | undefined;
    const onset = this.onsetAt(pos);
    if (onset && onset.time >= mark.time - 1e-6) {
      for (const id of onset.ids) {
        const head = root.querySelector(`[id="${id}"] use`) ?? root.querySelector(`[id="${id}"]`);
        const r = head?.getBoundingClientRect();
        if (r && r.width > 0 && r.left >= left - 1 && r.left <= right) {
          x = x === undefined ? r.left : Math.min(x, r.left);
        }
      }
      if (x !== undefined) x -= 3;
    }
    if (x === undefined) {
      const within = mark.duration > 0 ? Math.min(1, Math.max(0, (pos - mark.time) / mark.duration)) : 0;
      x = left + ((right - left) * (mark.measure - runStart + within)) / runLength;
    }

    if (!this.line) {
      this.line = document.createElement('div');
      this.line.className = 'play-cursor';
      this.line.setAttribute('aria-hidden', 'true');
      root.appendChild(this.line);
    }
    const base = root.getBoundingClientRect();
    const pad = 6;
    Object.assign(this.line.style, {
      display: 'block',
      left: `${x - base.left + root.scrollLeft}px`,
      top: `${top - pad - base.top + root.scrollTop}px`,
      height: `${bottom - top + pad * 2}px`,
    });
  }

  /** pos までに鳴り始めた、いちばん新しい鳴り始め */
  private onsetAt(pos: number) {
    const os = this.onsets;
    let lo = 0;
    let hi = os.length - 1;
    if (hi < 0 || os[0].time > pos) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (os[mid].time <= pos) lo = mid;
      else hi = mid - 1;
    }
    return os[lo];
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
