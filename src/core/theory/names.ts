// 画面に出す名前（調・音程）。

import type { Interval } from './interval';
import { formatInterval } from './interval';
import { tonicOf, type Key } from './key';

const ACC = ['𝄫', '♭', '', '♯', '𝄪'];

export function keyName(key: Key): string {
  const t = tonicOf(key);
  const sig = key.fifths === 0 ? '調号なし' : key.fifths > 0 ? `♯${key.fifths}つ` : `♭${-key.fifths}つ`;
  return `${t.step}${ACC[t.alter + 2]}${key.mode === 'major' ? 'メジャー' : 'マイナー'}（${sig}）`;
}

const QUALITY: Record<string, string> = { P: '完全', M: '長', m: '短', A: '増', d: '減', AA: '重増', dd: '重減' };

/** 'M2' → '長2度' */
export function intervalName(iv: Interval): string {
  const f = formatInterval(iv);
  const m = /^(AA|dd|P|M|m|A|d)(\d+)$/.exec(f);
  return m ? `${QUALITY[m[1]]}${m[2]}度` : f;
}

/** 移調楽器の説明：記譜 → 実音が { diatonic: -1, chromatic: -2 } なら「記譜の長2度下が鳴る」 */
export function transpositionName(t: Interval | null): string {
  if (!t || (t.diatonic === 0 && t.chromatic === 0)) return '記譜どおり';
  const down = t.chromatic < 0 || (t.chromatic === 0 && t.diatonic < 0);
  const abs = { diatonic: Math.abs(t.diatonic), chromatic: Math.abs(t.chromatic) };
  return `記譜の${intervalName(abs)}${down ? '下' : '上'}が鳴る`;
}
