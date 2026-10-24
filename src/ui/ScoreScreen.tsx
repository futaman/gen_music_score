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
import { checkRanges } from '../core/check/range';
import { shiftOctaves } from '../core/transpose/transpose';
import { exportMusicXml } from '../core/musicxml/export';
import { TransposePanel } from './TransposePanel';
import { RangePanel } from './RangePanel';
import { visiblePartIds } from './ScoreView';

type Props = { score: Score; fileName: string; onBack: () => void };

export function ScoreScreen({ score: original, fileName, onBack }: Props) {
  const device = useDevice();
  const { settings, update, reset } = useDisplaySettings(device);
  const [panel, setPanel] = useState<'settings' | 'transpose' | 'range' | null>(null);
  // 移調などで書き換えた楽譜（元の楽譜は original に残す）
  const [score, setScore] = useState(original);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const change = (next: Score, message: string) => {
    setScore(next);
    setRevision((r) => r + 1);
    setToast(message);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const index = useMemo(() => buildScoreIndex(score), [score]);

  // ---- 音域チェック（表示しているパートだけ）----
  const shownParts = useMemo(() => visiblePartIds(score, settings), [score, settings]);
  const issues = useMemo(() => checkRanges(score, shownParts), [score, shownParts]);
  const warnHeads = useMemo(() => new Set(issues.map((i) => i.headId)), [issues]);
  const jumpTo = (measure: number) => {
    const section = [...(viewRef.current?.querySelectorAll<HTMLElement>('section.chunk') ?? [])].find(
      (s) => Number(s.dataset.start) <= measure && measure < Number(s.dataset.end),
    );
    section?.scrollIntoView({ block: 'start', inline: 'start' });
  };
  const download = () => {
    const blob = new Blob([exportMusicXml(score)], { type: 'application/vnd.recordare.musicxml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.(mxl|musicxml|xml)$/i, '') + (score === original ? '' : '-編集') + '.musicxml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
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
    ? `${score.measures[mark.measure]?.displayNumber} / ${score.measures.length}小節`
    : `${score.measures.length}小節`;
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
              ['written', '記譜'],
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
        <button className="button" onClick={() => setPanel('transpose')}>
          移調
        </button>
        <button className="button" onClick={() => setPanel('settings')}>
          設定
        </button>
      </header>
      <main className="score-main">
        <ScoreView
          index={index}
          settings={settings}
          device={device}
          containerRef={viewRef}
          revision={revision}
          warnHeads={warnHeads}
          onZoom={(zoom) => update({ zoom })}
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
        extra={
          settings.warnings && issues.length > 0 ? (
            <button className="warn-chip" onClick={() => setPanel('range')} aria-label={`音域外 ${issues.length}`}>
              <span className="warn-long">音域外 </span>
              <span className="warn-short">⚠ </span>
              {issues.length}
            </button>
          ) : undefined
        }
      />
      {panel === 'settings' && (
        <SettingsPanel
          score={score}
          settings={settings}
          update={update}
          reset={reset}
          onDownload={download}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'transpose' && (
        <TransposePanel
          score={score}
          onChange={(next, message) => {
            change(next, message);
            setPanel(null);
          }}
          onPartCreated={(partId) => update({ view: 'part', partId, pitchMode: 'written' })}
          onReset={() => {
            change(original, '元の楽譜に戻しました');
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'range' && (
        <RangePanel
          score={score}
          issues={issues}
          onFix={(list) => {
            let next = score;
            for (const o of [-3, -2, -1, 1, 2, 3]) {
              const ids = new Set(list.filter((i) => i.suggestOctaves === o).map((i) => i.headId));
              if (ids.size) next = shiftOctaves(next, ids, o);
            }
            change(next, `${list.length}音のオクターブを動かしました`);
          }}
          onJump={(m) => {
            setPanel(null);
            jumpTo(m);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
