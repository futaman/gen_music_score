import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Player } from '../audio/player';
import { buildTimeline } from '../core/playback/timeline';
import { PlaybackCursor } from './playback';
import { PlayBar } from './PlayBar';
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
  const viewRef = useRef<HTMLDivElement>(null);

  // ---- 再生 ----
  const timeline = useMemo(() => buildTimeline(index), [index]);
  const [player] = useState(() => new Player());
  useSyncExternalStore(player.subscribe, player.getVersion);
  const cursor = useMemo(() => new PlaybackCursor(timeline, viewRef), [timeline]);
  const [startMeasure, setStartMeasure] = useState<number | null>(null);
  const [markIndex, setMarkIndex] = useState(0);
  const follow = settings.follow;
  useEffect(() => {
    player.setTimeline(timeline);
    return () => player.stop();
  }, [player, timeline]);
  useEffect(() => () => player.dispose(), [player]);
  // 止めたら色付けを消す
  useEffect(
    () =>
      player.subscribe(() => {
        if (player.state === 'stopped') cursor.reset();
      }),
    [player, cursor],
  );
  useEffect(() => {
    if (player.state !== 'playing') return;
    let raf = 0;
    const loop = () => {
      const pos = player.now();
      cursor.update(pos, follow);
      setMarkIndex(cursor.markAt(pos));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, player.state, cursor, follow]);
  const mark = player.state === 'stopped' ? undefined : timeline.measures[markIndex];
  const measureLabel = mark
    ? `${score.measures[mark.measure]?.displayNumber}小節目 / 全${score.measures.length}小節`
    : `全${score.measures.length}小節`;
  const play = () => {
    if (player.state === 'stopped' && startMeasure !== null) {
      const m = timeline.measures.find((x) => x.measure === startMeasure);
      if (m) player.seek(m.time);
    }
    void player.play(score.parts);
  };

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
        <ScoreView
          index={index}
          settings={settings}
          device={device}
          containerRef={viewRef}
          onMeasureTap={(mi) => {
            if (player.state === 'playing') return;
            setStartMeasure(mi);
            const m = timeline.measures.find((x) => x.measure === mi);
            if (m && player.state === 'paused') player.seek(m.time);
          }}
        />
      </main>
      <PlayBar
        player={player}
        score={score}
        measureLabel={measureLabel}
        startLabel={startMeasure !== null ? `${score.measures[startMeasure]?.displayNumber}小節目から` : undefined}
        onPlay={play}
      />
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
