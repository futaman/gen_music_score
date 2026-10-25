// パート譜の改ページを、休みの位置にずらす（譜めくりできるように）。純粋な関数だけ。
// 仕様：docs/dev-plan.md 5-3

/**
 * 段（system）の頭の小節index の列と、1ページに入る段の数から、改ページする段（その段の前で改ページ）を選ぶ。
 * 各ページの最後の2段の切れ目のうち、休み（canTurn(段の頭の小節) が true）の所をなるべく後ろで選ぶ。なければ入るだけ入れる
 * @param perPage ページ番号（0から）→ そのページに入る段の数
 */
export function choosePageBreaks(
  systemStarts: number[],
  perPage: (page: number) => number,
  canTurn: (measure: number) => boolean,
  lookBack = 2,
): number[] {
  const breaks: number[] = [];
  let i = 0;
  let page = 0;
  while (true) {
    const cap = Math.max(1, perPage(page));
    if (i + cap >= systemStarts.length) break;
    let j = i + cap;
    for (let k = i + cap; k >= Math.max(i + 1, i + cap - lookBack); k--) {
      if (canTurn(systemStarts[k])) {
        j = k;
        break;
      }
    }
    breaks.push(systemStarts[j]);
    i = j;
    page++;
  }
  return breaks;
}

/** Verovio の SVG（ページごと）から、段ごとの頭の小節index を読む（小節の id は m{index}） */
export function systemsFromSvg(pages: string[]): { starts: number[]; perPage: number[] } {
  const starts: number[] = [];
  const perPage: number[] = [];
  for (const svg of pages) {
    const parts = svg.split(/<g [^>]*class="system"/).slice(1);
    perPage.push(parts.length);
    for (const p of parts) {
      const id = /<g id="m(\d+)" class="measure/.exec(p);
      if (id) starts.push(Number(id[1]));
    }
  }
  return { starts, perPage };
}
