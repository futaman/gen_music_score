import { useEffect, useRef } from 'react';

type Props = { onKey: (midi: number) => void; center?: number };

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];

/** 鍵盤パネル（C2〜C7、横にスクロール）。押した高さの音を入れる */
export function Keyboard({ onKey, center = 60 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const keys: number[] = [];
  for (let m = 36; m <= 96; m++) keys.push(m);
  const whites = keys.filter((m) => !BLACK.has(m % 12));

  // 選んでいる音のあたりが見えるようにスクロールする
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-midi="${center - (center % 12)}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [center]);

  return (
    <div className="keyboard" ref={ref} role="group" aria-label="鍵盤">
      <div className="keys" style={{ width: whites.length * 40 }}>
        {whites.map((m, i) => (
          <button
            key={m}
            className="white"
            style={{ left: i * 40 }}
            data-midi={m}
            aria-label={`${NAMES[m % 12]}${Math.floor(m / 12) - 1}`}
            onClick={() => onKey(m)}
          >
            {m % 12 === 0 ? `C${Math.floor(m / 12) - 1}` : ''}
          </button>
        ))}
        {keys
          .filter((m) => BLACK.has(m % 12))
          .map((m) => {
            const i = whites.findIndex((w) => w > m);
            return (
              <button
                key={m}
                className="black"
                style={{ left: i * 40 - 13 }}
                data-midi={m}
                aria-label={`${NAMES[m % 12]}${Math.floor(m / 12) - 1}`}
                onClick={() => onKey(m)}
              />
            );
          })}
      </div>
    </div>
  );
}
