import { describe, expect, it } from 'vitest';
import { choosePageBreaks, systemsFromSvg } from './breaks';

describe('休みの位置で改ページ', () => {
  // 段の頭：0, 4, 8, … 36（10段）。1ページ4段
  const starts = Array.from({ length: 10 }, (_, i) => i * 4);
  it('休みがなければ入るだけ入れる', () => {
    expect(
      choosePageBreaks(
        starts,
        () => 4,
        () => false,
      ),
    ).toEqual([16, 32]);
  });
  it('ページの最後の2段の切れ目に休みがあれば、そこで改ページ（なるべく後ろ）', () => {
    expect(
      choosePageBreaks(
        starts,
        () => 4,
        (m) => m === 12 || m === 8,
      ),
    ).toEqual([12, 28]);
  });
  it('1ページ目だけ入る段が少ない（曲名の分）', () => {
    expect(
      choosePageBreaks(
        starts,
        (p) => (p === 0 ? 3 : 4),
        () => false,
      ),
    ).toEqual([12, 28]);
  });
  it('SVG から段の頭の小節を読む', () => {
    const page = (ms: number[][]) =>
      ms.map((sys) => `<g id="x" class="system">${sys.map((m) => `<g id="m${m}" class="measure">`).join('')}`).join('');
    expect(
      systemsFromSvg([
        page([
          [0, 1],
          [2, 3],
        ]),
        page([[4, 5]]),
      ]),
    ).toEqual({ starts: [0, 2, 4], perPage: [2, 1] });
  });
});
