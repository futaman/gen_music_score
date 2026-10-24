import { useEffect, useMemo, useState } from 'react';
import { buildScoreIndex } from '../core/model/scoreIndex';
import type { Score } from '../core/model/types';
import { ScoreView } from './ScoreView';
import { SettingsPanel } from './SettingsPanel';
import { useDevice, useDisplaySettings } from './settings';

type Props = { score: Score; onBack: () => void };

export function ScoreScreen({ score, onBack }: Props) {
  const device = useDevice();
  const { settings, update, reset } = useDisplaySettings(device);
  const [panel, setPanel] = useState(false);
  const index = useMemo(() => buildScoreIndex(score), [score]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  return (
    <div className={`score-screen device-${device}`}>
      <header className="toolbar">
        <button className="button" onClick={onBack} aria-label="戻る">
          ←
        </button>
        <h1 className="title">{score.title || '（曲名なし）'}</h1>
        <div className="segmented" role="radiogroup" aria-label="音の高さ">
          {(
            [
              ['written', '移調'],
              ['concert', '実音'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={settings.pitchMode === v ? 'on' : ''}>
              <input
                type="radio"
                name="pitch"
                checked={settings.pitchMode === v}
                onChange={() => update({ pitchMode: v })}
              />
              {label}
            </label>
          ))}
        </div>
        <select
          aria-label="表示するパート"
          value={settings.view === 'part' ? (settings.partId ?? score.parts[0]?.id) : settings.view}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'score' || v === 'selected') update({ view: v });
            else update({ view: 'part', partId: v });
          }}
        >
          <option value="score">総譜</option>
          {settings.view === 'selected' && <option value="selected">選んだパート</option>}
          {score.parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
        <button className="button" onClick={() => setPanel(true)}>
          設定
        </button>
      </header>
      <main className="score-main">
        <ScoreView index={index} settings={settings} device={device} />
      </main>
      {panel && (
        <SettingsPanel
          score={score}
          settings={settings}
          update={update}
          reset={reset}
          onClose={() => setPanel(false)}
        />
      )}
    </div>
  );
}
