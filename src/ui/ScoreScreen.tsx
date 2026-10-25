import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Player } from '../audio/player';
import { checkRanges } from '../core/check/range';
import {
  clearRange,
  copyRange,
  deleteMeasures,
  enterMidi,
  enterPitch,
  addChordTone,
  applyAlternative,
  melodyAlternatives,
  insertMeasures,
  makeTuplet,
  moveRangeToPart,
  movePitch,
  nextEvent,
  octaveRange,
  overfullVoices,
  pasteRange,
  previousEvent,
  setDuration,
  setDynamic,
  setKeySignature,
  setTimeSignature,
  toggleArticulation,
  toggleDot,
  toggleSlur,
  toggleTie,
  toRest,
  type Clipboard,
  type EditResult,
  type Selection,
} from '../core/edit/commands';
import { buildScoreIndex } from '../core/model/scoreIndex';
import type { Arrangement, Note, NoteType, Score } from '../core/model/types';
import { checkArrangement } from '../core/arrange/check';
import { reassign } from '../core/arrange/workspace';
import { ArrangePanel } from './ArrangePanel';
import { exportMusicXml } from '../core/musicxml/export';
import { buildTimeline, type Timeline } from '../core/playback/timeline';
import { midi, type Step } from '../core/theory/pitch';
import { shiftOctaves } from '../core/transpose/transpose';
import { EditBar, type EditAction } from './EditBar';
import { ExportPanel } from './ExportPanel';
import { Keyboard } from './Keyboard';
import { PlaybackCursor } from './playback';
import { PlayBar } from './PlayBar';
import { RangePanel } from './RangePanel';
import { ScoreView, visiblePartIds, type Marks, type ScoreTap } from './ScoreView';
import { SettingsPanel } from './SettingsPanel';
import { useDevice, useDisplaySettings } from './settings';
import { TransposePanel } from './TransposePanel';
import { useEditor } from './useEditor';

type Props = {
  score: Score;
  /** 書き出すファイルの名前のもと */
  name: string;
  onBack: () => void;
  /** 編集したら呼ぶ（自動保存用） */
  onScoreChange?: (score: Score) => void;
  /** 保存の状態（ツールバーに出す） */
  saveStatus?: string;
  /** プロジェクトをファイルに保存する */
  onSaveProject?: () => void;
  /** 開ける楽譜（元の楽譜と、編曲で作った楽譜）。2つ以上あれば切り替えを出す */
  scores?: { id: string; label: string }[];
  onSelectScore?: (id: string) => void;
  /** 編曲で作った楽譜を開いているとき：元の楽譜と割当表 */
  arrange?: { source: Score; arrangement: Arrangement; onChange: (a: Arrangement) => void; onDelete: () => void };
  /** 元の楽譜から編曲案を作る */
  onCreateArrangement?: (ensembleId: string, rotateMelody: boolean) => void;
};

const DURATION_KEYS: Record<string, NoteType> = {
  '1': '64th',
  '2': '32nd',
  '3': '16th',
  '4': 'eighth',
  '5': 'quarter',
  '6': 'half',
  '7': 'whole',
};

/** 画面に描いた要素の id（単音は音の id、和音・休符は音符の id） */
const elementIdOf = (n: Note) => (n.heads.length === 1 ? n.heads[0].id : n.id);

export function ScoreScreen({
  score: original,
  name,
  onBack,
  onScoreChange,
  saveStatus,
  onSaveProject,
  scores,
  onSelectScore,
  arrange,
  onCreateArrangement,
}: Props) {
  const device = useDevice();
  const { settings, update, reset } = useDisplaySettings(device);
  const [panel, setPanel] = useState<
    'settings' | 'transpose' | 'range' | 'export' | 'arrange' | 'arrange-warnings' | null
  >(null);
  const editor = useEditor(original);
  const { score } = editor;
  useEffect(() => {
    onScoreChange?.(score);
  }, [score, onScoreChange]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const index = useMemo(() => buildScoreIndex(score), [score]);
  const noteById = useMemo(() => new Map(score.notes.map((n) => [n.id, n])), [score]);
  const viewRef = useRef<HTMLDivElement>(null);

  // ---- 選択 ----
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [slurPending, setSlurPending] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const selectedNote = selection?.kind === 'note' ? noteById.get(selection.noteId) : undefined;
  const alternatives = useMemo(
    () => (selectedNote ? melodyAlternatives(score, selectedNote.id) : []),
    [score, selectedNote],
  );
  const shownParts = useMemo(() => visiblePartIds(score, settings), [score, settings]);

  // ---- 再生 ----
  const [player] = useState(() => new Player());
  useSyncExternalStore(player.subscribe, player.getVersion);
  useEffect(() => () => player.dispose(), [player]);
  // 再生の準備（イベント列）は再生するときに作る（編集のたびに作ると遅いため）
  const [playing, setPlaying] = useState<{ index: typeof index; timeline: Timeline; cursor: PlaybackCursor } | null>(
    null,
  );
  const [markIndex, setMarkIndex] = useState(0);
  const follow = settings.follow;
  useEffect(
    () =>
      player.subscribe(() => {
        if (player.state === 'stopped') playing?.cursor.reset();
      }),
    [player, playing],
  );
  useEffect(() => {
    if (player.state !== 'playing' || !playing) return;
    let raf = 0;
    const loop = () => {
      const pos = player.now();
      playing.cursor.update(pos, follow);
      setMarkIndex(playing.cursor.markAt(pos));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, player.state, playing, follow]);
  const startMeasure = selectedNote?.measure ?? (selection?.kind === 'range' ? selection.start : null);
  const mark = player.state === 'stopped' || !playing ? undefined : playing.timeline.measures[markIndex];
  const measureLabel = mark
    ? `${score.measures[mark.measure]?.displayNumber} / ${score.measures.length}小節`
    : `${score.measures.length}小節`;
  const play = () => {
    let p = playing;
    if (!p || p.index !== index) {
      player.stop();
      const timeline = buildTimeline(index);
      p = { index, timeline, cursor: new PlaybackCursor(timeline, viewRef) };
      player.setTimeline(timeline);
      setPlaying(p);
    }
    if (player.state === 'stopped' && startMeasure !== null) {
      const m = p.timeline.measures.find((x) => x.measure === startMeasure);
      if (m) player.seek(m.time);
    }
    void player.play(score.parts);
  };

  // ---- 編集 ----
  const apply = useCallback(
    (r: EditResult, label: string) => {
      if (player.state === 'playing') player.pause();
      const message = editor.apply(r, label);
      if (r.select) setSelection(r.select);
      const over = r.changed === 'all' ? [] : overfullVoices(r.score, r.changed);
      setToast(
        over.length
          ? `${score.measures[over[0].measure]?.displayNumber}小節目の拍があふれています（赤い音）`
          : (message ?? null),
      );
    },
    [editor, player, score.measures],
  );
  const replaceScore = (next: Score, message: string) => {
    apply({ score: next, changed: 'all' }, message);
    setToast(message);
  };

  const doAction = (a: EditAction) => {
    if (a.type === 'deselect') {
      setSelection(null);
      setRangeMode(false);
      setSlurPending(false);
      return;
    }
    if (a.type === 'range') return setRangeMode((v) => !v);
    if (a.type === 'keyboard') return setKeyboardOpen((v) => !v);
    if (selection?.kind === 'note' && selectedNote) {
      const n = selectedNote;
      const heads = selection.headId ? [selection.headId] : n.heads.map((h) => h.id);
      switch (a.type) {
        case 'pitch':
          return apply(movePitch(score, heads, a.how), '音高');
        case 'duration':
          return apply(setDuration(score, n.id, a.value), '音価');
        case 'dot':
          return apply(toggleDot(score, n.id), '付点');
        case 'triplet':
          return apply(makeTuplet(score, n.id), '3連符');
        case 'rest':
          return apply(toRest(score, [n.id]), '休符');
        case 'tie':
          return apply(toggleTie(score, n.id), 'タイ');
        case 'slur':
          setSlurPending((v) => !v);
          return setToast('スラーの終わりの音をタップしてください');
        case 'artic':
          return apply(toggleArticulation(score, [n.id], a.name), '記号');
        case 'dynamic':
          return apply(setDynamic(score, n.id, a.value), '強弱');
        case 'alternative':
          return apply(applyAlternative(score, n.id, alternatives[a.index]), '音の差し替え');
      }
    }
    if (selection?.kind === 'range') {
      const r = selection;
      switch (a.type) {
        case 'copy':
          setClipboard(copyRange(score, r));
          return setToast(`${r.end - r.start}小節をコピーしました`);
        case 'paste':
          if (!clipboard) return setToast('コピーしたものがありません');
          return apply(pasteRange(score, r.partIds, r.start, clipboard), '貼り付け');
        case 'clear':
          return apply(clearRange(score, r), '消す');
        case 'range-octave':
          return apply(octaveRange(score, r, a.octaves), 'オクターブ');
        case 'move-to':
          return apply(moveRangeToPart(score, r, a.partId), '別の楽器へ移す');
        case 'insert-measure':
          return apply(insertMeasures(score, r.start, 1), '小節を挿入');
        case 'delete-measures':
          setSelection(null);
          return apply(deleteMeasures(score, r.start, r.end), '小節を削除');
        case 'time':
          return apply(setTimeSignature(score, r.start, a.beats, a.beatType), '拍子');
        case 'key':
          return apply(setKeySignature(score, r.start, a.fifths), '調号');
      }
    }
  };

  const onTap = (t: ScoreTap) => {
    if (player.state === 'playing') return;
    const note = t.elementId ? (index.noteOfHead.get(t.elementId) ?? noteById.get(t.elementId)) : undefined;
    let target: { partId: string; measure: number } | null = note
      ? { partId: note.partId, measure: note.measure }
      : null;
    if (!target && t.staffId && t.measure !== undefined) {
      const m = /^s(\d+)-(.+)-(\d+)$/.exec(t.staffId);
      if (m) target = { partId: m[2], measure: Number(m[1]) };
    }
    if (!target) return;
    if (slurPending && note && selectedNote) {
      setSlurPending(false);
      return apply(toggleSlur(score, selectedNote.id, note.id), 'スラー');
    }
    if ((t.shift || rangeMode) && selection) {
      const anchor =
        selection.kind === 'note'
          ? { partId: selectedNote?.partId ?? target.partId, measure: selectedNote?.measure ?? target.measure }
          : { partId: selection.partIds[0], measure: selection.start };
      const order = shownParts;
      const [a, b] = [order.indexOf(anchor.partId), order.indexOf(target.partId)].sort((x, y) => x - y);
      setSelection({
        kind: 'range',
        partIds: order.slice(Math.max(0, a), b + 1),
        start: Math.min(anchor.measure, target.measure),
        end: Math.max(anchor.measure, target.measure) + 1,
      });
      setRangeMode(false);
      return;
    }
    if (note)
      setSelection({
        kind: 'note',
        noteId: note.id,
        headId: note.heads.length > 1 && t.elementId !== note.id ? t.elementId : undefined,
      });
    else setSelection({ kind: 'range', partIds: [target.partId], start: target.measure, end: target.measure + 1 });
    if (player.state === 'paused') player.stop();
  };

  // ---- キーボード（PC） ----
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea') || panel) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        return editor.redo();
      }
      if (e.key === 'Escape') return doAction({ type: 'deselect' });
      if (selection?.kind === 'range') {
        if (mod && e.key.toLowerCase() === 'c') return doAction({ type: 'copy' });
        if (mod && e.key.toLowerCase() === 'v') return doAction({ type: 'paste' });
        if (e.key === 'Delete' || e.key === 'Backspace') return doAction({ type: 'clear' });
        return;
      }
      if (!selectedNote) return;
      const n = selectedNote;
      const letter = e.key.toUpperCase();
      if (!mod && /^[A-G]$/.test(letter)) {
        e.preventDefault();
        if (e.shiftKey) return apply(addChordTone(score, n.id, letter as Step), '和音');
        return apply(enterPitch(score, n.id, letter as Step), '音名');
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const up = e.key === 'ArrowUp';
        return doAction({
          type: 'pitch',
          how: mod ? (up ? 'octave-up' : 'octave-down') : up ? 'semitone-up' : 'semitone-down',
        });
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? nextEvent(score, n) : previousEvent(score, n);
        if (next) setSelection({ kind: 'note', noteId: next.id });
        return;
      }
      if (mod && e.key === '3') {
        e.preventDefault();
        return doAction({ type: 'triplet' });
      }
      if (!mod && DURATION_KEYS[e.key]) return doAction({ type: 'duration', value: DURATION_KEYS[e.key] });
      if (e.key === '.') return doAction({ type: 'dot' });
      if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') return doAction({ type: 'rest' });
      if (!mod && e.key.toLowerCase() === 't') return doAction({ type: 'tie' });
      if (!mod && e.key.toLowerCase() === 's') return doAction({ type: 'slur' });
      if (!mod && e.key.toLowerCase() === 'j') return doAction({ type: 'pitch', how: 'enharmonic' });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // ---- 警告 ----
  const issues = useMemo(() => checkRanges(score, shownParts), [score, shownParts]);
  const arrangeSource = arrange?.source;
  const arrangement = arrange?.arrangement;
  const arrangeWarnings = useMemo(
    () => (arrangeSource && arrangement ? checkArrangement(score, { source: arrangeSource, arrangement }) : []),
    [arrangeSource, arrangement, score],
  );
  const overfull = useMemo(() => overfullVoices(score), [score]);
  const warn = useMemo(() => {
    const set = new Set(issues.map((i) => i.headId));
    for (const o of overfull) {
      for (const n of score.notes) {
        if (n.partId === o.partId && n.measure === o.measure && n.staff === o.staff && n.voice === o.voice)
          set.add(elementIdOf(n));
      }
    }
    for (const w of arrangeWarnings)
      for (const id of w.noteIds) {
        const n = noteById.get(id);
        if (n) set.add(elementIdOf(n));
      }
    return set;
  }, [issues, overfull, score.notes, arrangeWarnings, noteById]);
  // 編曲で作った楽譜：手で直した音
  const edited = useMemo(
    () =>
      new Set(
        arrangement && settings.showEdits
          ? score.notes.filter((n) => n.origin !== 'generated' && n.heads.length).map(elementIdOf)
          : [],
      ),
    [arrangement, settings.showEdits, score.notes],
  );
  const marks = useMemo((): Marks => {
    const sel = new Set<string>();
    const selStaff = new Set<string>();
    if (selection?.kind === 'note' && selectedNote) sel.add(selection.headId ?? elementIdOf(selectedNote));
    if (selection?.kind === 'range') {
      for (const pid of selection.partIds) {
        const staves = score.parts.find((p) => p.id === pid)?.staves ?? 1;
        for (let m = selection.start; m < selection.end; m++)
          for (let st = 1; st <= staves; st++) selStaff.add(`s${m}-${pid}-${st}`);
      }
    }
    return { sel, 'sel-staff': selStaff, edited, ...(settings.warnings ? { warn } : {}) };
  }, [selection, selectedNote, score.parts, settings.warnings, warn, edited]);

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
    a.download = name.replace(/\.(mxl|musicxml|xml)$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '.musicxml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const keyboardCenter = selectedNote?.heads[0] ? midi(selectedNote.heads[0].pitch) : 60;

  return (
    <div
      className={`score-screen device-${device}${selection ? ' editing' : ''}${keyboardOpen && selectedNote ? ' with-keyboard' : ''}`}
    >
      <header className="toolbar">
        <button className="button" onClick={onBack} aria-label="戻る">
          ←
        </button>
        <h1 className="title">{score.title || name || '（曲名なし）'}</h1>
        {saveStatus && (
          <span className="save-status muted" aria-live="polite" data-testid="save-status">
            {saveStatus}
          </span>
        )}
        <button
          className="button"
          onClick={editor.undo}
          disabled={!editor.canUndo}
          aria-label="元に戻す"
          title="元に戻す（Ctrl+Z）"
        >
          ↶
        </button>
        <button
          className="button"
          onClick={editor.redo}
          disabled={!editor.canRedo}
          aria-label="やり直し"
          title="やり直し（Ctrl+Shift+Z）"
        >
          ↷
        </button>
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
        {scores && scores.length > 1 && (
          <select aria-label="楽譜" value={score.id} onChange={(e) => onSelectScore?.(e.target.value)}>
            {scores.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        )}
        {(arrange || onCreateArrangement) && (
          <button className="button" onClick={() => setPanel('arrange')}>
            編曲
          </button>
        )}
        <button className="button" onClick={() => setPanel('export')}>
          書き出し
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
          edit={editor.edit}
          marks={marks}
          onTap={onTap}
          onZoom={(zoom) => update({ zoom })}
        />
      </main>
      {selection && (
        <EditBar
          score={score}
          selection={selection}
          rangeMode={rangeMode}
          slurPending={slurPending}
          keyboardOpen={keyboardOpen}
          canPaste={!!clipboard}
          alternatives={alternatives}
          onAction={doAction}
        />
      )}
      {selection?.kind === 'note' && keyboardOpen && (
        <Keyboard center={keyboardCenter} onKey={(m) => apply(enterMidi(score, selection.noteId, m), '鍵盤')} />
      )}
      <PlayBar
        player={player}
        score={score}
        measureLabel={measureLabel}
        startLabel={startMeasure !== null ? `${score.measures[startMeasure]?.displayNumber}小節目から` : undefined}
        onPlay={play}
        extra={
          arrange && settings.warnings && arrangeWarnings.length > 0 ? (
            <button
              className="warn-chip"
              onClick={() => setPanel('arrange-warnings')}
              aria-label={`編曲の警告 ${arrangeWarnings.length}`}
            >
              <span className="warn-long">編曲の警告 </span>
              <span className="warn-short">⚠ </span>
              {arrangeWarnings.length}
            </button>
          ) : settings.warnings && issues.length > 0 ? (
            <button className="warn-chip" onClick={() => setPanel('range')} aria-label={`音域外 ${issues.length}`}>
              <span className="warn-long">音域外 </span>
              <span className="warn-short">⚠ </span>
              {issues.length}
            </button>
          ) : undefined
        }
      />
      {panel === 'settings' && (
        <SettingsPanel score={score} settings={settings} update={update} reset={reset} onClose={() => setPanel(null)} />
      )}
      {(panel === 'arrange' || panel === 'arrange-warnings') && (
        <ArrangePanel
          score={score}
          arrangement={arrange?.arrangement}
          source={arrange?.source}
          warnings={arrangeWarnings}
          initialTab={panel === 'arrange-warnings' ? 'warnings' : 'table'}
          onCreate={(ensembleId, rotate) => {
            setPanel(null);
            onCreateArrangement?.(ensembleId, rotate);
          }}
          onReassign={(sectionId, inst, units) => {
            if (!arrange) return;
            const r = reassign(arrange.source, arrange.arrangement, score, sectionId, inst, units);
            arrange.onChange(r.arrangement);
            if (r.result.changed !== 'all' && r.result.changed.length === 0)
              setToast(r.result.message ?? '手で直した小節だけなので、作り直しませんでした');
            else apply(r.result, '割当の変更');
          }}
          onDelete={
            arrange
              ? () => {
                  setPanel(null);
                  arrange.onDelete();
                }
              : undefined
          }
          onJump={(m, partId) => {
            setPanel(null);
            jumpTo(m);
            if (partId) setSelection({ kind: 'range', partIds: [partId], start: m, end: m + 1 });
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'export' && (
        <ExportPanel
          index={index}
          name={name}
          shownPartIds={shownParts}
          settings={settings}
          onDownloadMusicXml={download}
          onSaveProject={onSaveProject}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'transpose' && (
        <TransposePanel
          score={score}
          onChange={(next, message) => {
            replaceScore(next, message);
            setPanel(null);
          }}
          onPartCreated={(partId) => update({ view: 'part', partId, pitchMode: 'written' })}
          onReset={() => {
            replaceScore(original, '開いたときの状態に戻しました（元に戻すで取り消せます）');
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
            apply(
              { score: next, changed: [...new Set(list.map((i) => i.measure))] },
              `${list.length}音のオクターブを動かしました`,
            );
            setToast(`${list.length}音のオクターブを動かしました`);
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
