import { useState } from 'react';
import type { Player } from '../audio/player';
import type { Score } from '../core/model/types';

type Props = {
  player: Player;
  score: Score;
  measureLabel: string;
  startLabel?: string;
  onPlay: () => void;
  /** 再生バーに並べるほかのボタン（音域外の警告など） */
  extra?: React.ReactNode;
};

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 画面下に固定する再生バー */
export function PlayBar({ player, score, measureLabel, startLabel, onPlay, extra }: Props) {
  const [mixer, setMixer] = useState(false);
  const [hint, setHint] = useState(false);
  const playing = player.state === 'playing';

  return (
    <>
      <div className="playbar" role="toolbar" aria-label="再生">
        <button className="button" aria-label="先頭へ" onClick={() => player.stop()}>
          ⏮
        </button>
        <button
          className="button primary play"
          aria-label={playing ? '一時停止' : '再生'}
          disabled={player.state === 'loading'}
          onClick={() => {
            if (playing) player.pause();
            else {
              if (isIOS() && !sessionStorageGet('soundHint')) setHint(true);
              onPlay();
            }
          }}
        >
          {player.state === 'loading' ? '…' : playing ? '⏸' : '▶'}
        </button>
        <span className="position" aria-live="off">
          {player.state === 'loading'
            ? '音源を読み込み中…'
            : startLabel && player.state === 'stopped'
              ? startLabel
              : measureLabel}
        </span>
        <Tempo player={player} />
        {extra}
        <button className="button" onClick={() => setMixer(true)}>
          {/* スマホでは、テンポもこの画面で変える */}
          パート
        </button>
      </div>
      {hint && (
        <div className="toast" role="status">
          音が出ないときは、消音モード（マナーモード）を解除してください。
          <button
            className="button"
            onClick={() => {
              setHint(false);
              sessionStorageSet('soundHint', '1');
            }}
          >
            閉じる
          </button>
        </div>
      )}
      {mixer && (
        <div className="sheet-backdrop" onClick={() => setMixer(false)}>
          <section className="sheet" role="dialog" aria-label="テンポとパートの音" onClick={(e) => e.stopPropagation()}>
            <header className="sheet-header">
              <h2>テンポとパートの音</h2>
              <button className="button" onClick={() => setMixer(false)}>
                閉じる
              </button>
            </header>
            <div className="mixer-tempo">
              <Tempo player={player} />
            </div>
            <ul className="mixer">
              {score.parts.map((p) => (
                <li key={p.id}>
                  <span>{p.name || p.id}</span>
                  <button
                    className={`button${player.isSolo(p.id) ? ' primary' : ''}`}
                    aria-pressed={player.isSolo(p.id)}
                    onClick={() => player.setSolo(p.id, !player.isSolo(p.id))}
                  >
                    ソロ
                  </button>
                  <button
                    className={`button${player.isMuted(p.id) ? ' primary' : ''}`}
                    aria-pressed={player.isMuted(p.id)}
                    onClick={() => player.setMute(p.id, !player.isMuted(p.id))}
                  >
                    ミュート
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function sessionStorageGet(k: string) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k: string, v: string) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    // 保存できなくても問題ない
  }
}

function Tempo({ player }: { player: Player }) {
  return (
    <label className="tempo">
      <span>テンポ</span>
      <input
        type="range"
        min={50}
        max={150}
        step={5}
        value={Math.round(player.rate * 100)}
        aria-label="テンポ（%）"
        onChange={(e) => player.setRate(Number(e.target.value) / 100)}
      />
      <span className="tempo-value">{Math.round(player.rate * 100)}%</span>
    </label>
  );
}
