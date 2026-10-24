import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chunkSize, chunkToMei, staffLayout, type ChunkOptions } from '../core/mei/chunk';
import type { ScoreIndex } from '../core/model/scoreIndex';
import type { Score } from '../core/model/types';
import { Renderer } from '../render/renderer';
import type { Device, DisplaySettings } from './settings';

const BASE_SCALE: Record<Device, number> = { pc: 38, tablet: 34, phone: 28 };
// 楽器ごとの色（明るい背景・暗い背景のどちらでも読める濃さ）
const PART_COLORS = ['#1f6fd1', '#c2410c', '#15803d', '#9333ea', '#b91c1c', '#0e7490', '#a16207', '#be185d'];

export function visiblePartIds(score: Score, s: DisplaySettings): string[] {
  const all = score.parts.map((p) => p.id);
  if (s.view === 'part') return [s.partId && all.includes(s.partId) ? s.partId : all[0]];
  if (s.view === 'selected') {
    const sel = (s.selectedPartIds ?? []).filter((id) => all.includes(id));
    return sel.length ? all.filter((id) => sel.includes(id)) : all;
  }
  return all;
}

type Props = { index: ScoreIndex; settings: DisplaySettings; device: Device };

/** 楽譜の表示。数小節ずつのチャンクに分け、画面に近いものだけを描く */
export function ScoreView({ index, settings, device }: Props) {
  const renderer = useMemo(() => new Renderer(), []);
  useEffect(() => () => renderer.dispose(), [renderer]);
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);

  const score = index.score;
  const partIds = useMemo(() => visiblePartIds(score, settings), [score, settings]);
  const staffCount = useMemo(() => staffLayout(index, partIds).length, [index, partIds]);
  const baseSize = chunkSize(staffCount);
  const scale = Math.round(BASE_SCALE[device] * (settings.zoom === 'fit' ? 1 : settings.zoom / 100));

  const verovioOptions = useMemo(() => {
    const common = {
      scale,
      header: 'none',
      footer: 'none',
      adjustPageHeight: true,
      pageHeight: 60000,
      pageMarginTop: 30,
      pageMarginBottom: 30,
      pageMarginLeft: 20,
      pageMarginRight: 20,
      mnumInterval: settings.measureNumbers === 'every' ? 1 : settings.measureNumbers === 'five' ? 5 : 0,
      lyricSize: 3,
    };
    if (settings.layout === 'horizontal') return { ...common, breaks: 'none', adjustPageWidth: true, pageWidth: 60000 };
    // ページ表示：A4 の幅（210mm）で組む。縦の連続表示：画面幅で組む
    const pageWidth = settings.layout === 'page' ? 2100 : Math.max(500, Math.round(((width - 2) * 100) / scale));
    return { ...common, breaks: 'auto', pageWidth };
  }, [scale, settings.layout, settings.measureNumbers, width]);

  const chunkOptions = useMemo((): Omit<ChunkOptions, 'start' | 'end' | 'labels'> => {
    const colors =
      settings.colorBy === 'instrument'
        ? Object.fromEntries(score.parts.map((p, i) => [p.id, PART_COLORS[i % PART_COLORS.length]]))
        : undefined;
    return {
      partIds,
      pitchMode: settings.pitchMode,
      noteNames: settings.noteNames === 'none' ? undefined : settings.noteNames,
      colors,
      noKeySignatureParts:
        settings.hornKeySignature === 'without'
          ? score.parts.filter((p) => p.instrumentId.startsWith('horn')).map((p) => p.id)
          : [],
    };
  }, [partIds, score.parts, settings.colorBy, settings.hornKeySignature, settings.noteNames, settings.pitchMode]);

  // 設定が変わったら全チャンクを作り直す
  const version = useMemo(() => JSON.stringify([verovioOptions, chunkOptions]), [verovioOptions, chunkOptions]);

  // 1段に入る小節数。最初のチャンクを描いて分かったら、チャンクの区切りを段の切れ目に合わせる
  //（チャンクの最後に短い段が残らないように）
  const [fit, setFit] = useState<{ version: string; perSystem: number } | null>(null);
  const perSystem = settings.layout !== 'horizontal' && fit?.version === version ? fit.perSystem : null;
  const size = perSystem ? perSystem * Math.max(1, Math.round(baseSize / perSystem)) : baseSize;
  const onLayout = useCallback(
    (systems: number[]) => {
      if (systems.length > 1) setFit({ version, perSystem: Math.max(1, systems[0]) });
    },
    [version],
  );

  const chunks = useMemo(() => {
    const list: { start: number; end: number }[] = [];
    for (let start = 0; start < score.measures.length; start += size) {
      list.push({ start, end: Math.min(score.measures.length, start + size) });
    }
    return list;
  }, [score.measures.length, size]);
  const estHeight = Math.round(staffCount * 22 * (scale / 10) + 60);

  return (
    <div
      ref={ref}
      className={`score-view layout-${settings.layout}${settings.measureNumbers === 'none' ? ' hide-mnum' : ''}`}
      data-testid="score-view"
    >
      {width > 0 &&
        chunks.map((c) => (
          <Chunk
            key={`${version}-${size}-${c.start}`}
            index={index}
            renderer={renderer}
            options={{ ...chunkOptions, ...c, labels: c.start === 0 ? 'full' : 'abbr' }}
            verovioOptions={verovioOptions}
            estHeight={estHeight}
            onLayout={c.start === 0 && !perSystem && settings.layout !== 'horizontal' ? onLayout : undefined}
          />
        ))}
    </div>
  );
}

type ChunkProps = {
  index: ScoreIndex;
  renderer: Renderer;
  options: ChunkOptions;
  verovioOptions: Record<string, unknown>;
  estHeight: number;
  /** 描いたあと、段ごとの小節数を知らせる */
  onLayout?: (measuresPerSystem: number[]) => void;
};

function Chunk({ index, renderer, options, verovioOptions, estHeight, onLayout }: ChunkProps) {
  const ref = useRef<HTMLElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let requested = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (requested || !entries.some((e) => e.isIntersecting)) return;
        requested = true;
        io.disconnect();
        renderer.render(chunkToMei(index, options), verovioOptions).then((r) => {
          if (cancelled) return;
          if (r.error) setError(r.error);
          else {
            setSvg(r.svg);
            onLayout?.(measuresPerSystem(r.svg));
          }
        });
      },
      { rootMargin: '1200px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
    // チャンクは設定が変わると key ごと作り直すので、ここでは最初の値だけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = `${index.score.measures[options.start]?.displayNumber}〜${index.score.measures[options.end - 1]?.displayNumber}小節`;
  if (error) {
    return (
      <section ref={ref} className="chunk chunk-error">
        {label}を描けませんでした：{error}
      </section>
    );
  }
  return svg ? (
    <section ref={ref} className="chunk" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <section ref={ref} className="chunk placeholder" aria-label={`${label}（描画中）`} style={{ height: estHeight }} />
  );
}

/** 要素の幅（最初はすぐ、リサイズ時は少し待ってから反映） */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      clearTimeout(timer);
      const apply = () => setWidth((prev) => (Math.abs(prev - w) > 4 ? w : prev));
      if (first) {
        first = false;
        apply();
      } else timer = setTimeout(apply, 250);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [ref]);
  return width;
}

/** Verovio の SVG から、段（g.system）ごとの小節数を数える */
function measuresPerSystem(svg: string): number[] {
  return svg
    .split('class="system"')
    .slice(1)
    .map((part) => (part.match(/class="measure"/g) ?? []).length);
}
