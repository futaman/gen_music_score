// PDF 書き出し：Verovio でページごとの SVG を描き、svg2pdf.js で jsPDF のページに描く。
// 日本語などラテン文字以外があるときだけ、日本語フォント（BIZ UDP明朝を JIS X 0208 に絞ったもの）を読み込んで埋め込む。
// 仕様：docs/spec.md「出力」、docs/dev-plan.md ステップ5

import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { chunkToMei, staffLayout } from '../core/mei/chunk';
import type { PitchMode } from '../core/model/display';
import type { ScoreIndex } from '../core/model/scoreIndex';
import { Renderer } from '../render/renderer';

export type PaperSize = 'a4' | 'a4-landscape' | 'b4' | 'a3' | 'letter';

/** 用紙（mm） */
export const PAPERS: Record<PaperSize, { w: number; h: number; label: string }> = {
  a4: { w: 210, h: 297, label: 'A4 縦' },
  'a4-landscape': { w: 297, h: 210, label: 'A4 横' },
  b4: { w: 257, h: 364, label: 'B4 縦' },
  a3: { w: 297, h: 420, label: 'A3 縦' },
  letter: { w: 215.9, h: 279.4, label: 'レター 縦' },
};

/** PDF の中の1つの楽譜（総譜か、1つのパート譜） */
export type PdfDocument = { partIds: string[]; partName?: string; pitchMode: PitchMode };

export type PdfJob = {
  index: ScoreIndex;
  paper: PaperSize;
  title: string;
  subtitle?: string;
  composer?: string;
  documents: PdfDocument[];
  onProgress?: (done: number, total: number) => void;
};

const JP_FONT = 'BIZUDPMincho';
const MARGIN = 100; // Verovio の単位（0.1mm）

/** 段の数に合わせた大きさ（Verovio の scale。40 で五線の高さ約7mm） */
export function scaleFor(staffCount: number): number {
  if (staffCount <= 2) return 40;
  return Math.max(20, Math.min(38, Math.round(42 - staffCount * 1.2)));
}

/** Verovio に渡す設定（印刷用） */
export function pdfVerovioOptions(paper: PaperSize, staffCount: number): Record<string, unknown> {
  const p = PAPERS[paper];
  return {
    pageWidth: Math.round(p.w * 10),
    pageHeight: Math.round(p.h * 10),
    pageMarginLeft: MARGIN,
    pageMarginRight: MARGIN,
    pageMarginTop: MARGIN,
    pageMarginBottom: MARGIN + 50, // ページ番号の分
    scale: scaleFor(staffCount),
    breaks: 'auto',
    header: 'encoded',
    footer: 'none',
    adjustPageHeight: false,
    svgViewBox: true,
    multiRestStyle: 'block',
    justifyVertically: false,
  };
}

/** ラテン文字（WinAnsi）で書けない文字を含むか */
const needsJapanese = (text: string) => [...text].some((c) => c.charCodeAt(0) > 0xff);

/**
 * SVG を PDF 用に整える：ラテン文字以外を含む文字列は日本語フォントで書く。
 * 戻り値は日本語フォントが要るかどうか
 */
export function prepareSvg(svg: SVGSVGElement): boolean {
  // 内側の svg（Verovio の拡大縮小用）には大きさがないので、外側と同じ大きさを書いておく（svg2pdf.js は 100% を解かない）
  const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/);
  if (w && h) {
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    for (const inner of svg.querySelectorAll('svg')) {
      if (!inner.hasAttribute('width')) inner.setAttribute('width', w);
      if (!inner.hasAttribute('height')) inner.setAttribute('height', h);
    }
  }
  let japanese = false;
  for (const el of svg.querySelectorAll('tspan, text')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '');
    if (own.some(needsJapanese)) {
      el.setAttribute('font-family', JP_FONT);
      japanese = true;
    }
  }
  return japanese;
}

let fontData: Promise<string> | null = null;

/** 日本語フォントを読み込み、jsPDF に渡せる形（1バイト1文字の文字列）にする */
function loadJapaneseFont(): Promise<string> {
  fontData ??= fetch(`${import.meta.env.BASE_URL}fonts/BIZUDPMincho-Regular-jis.ttf`)
    .then((r) => {
      if (!r.ok) throw new Error(`日本語フォントを読み込めませんでした（${r.status}）`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return s;
    })
    .catch((e: unknown) => {
      fontData = null;
      throw e;
    });
  return fontData;
}

/** PDF を作る。ページ番号は楽譜（パート）ごとに1から */
export async function makePdf(job: PdfJob): Promise<Blob> {
  const paper = PAPERS[job.paper];
  const doc = new jsPDF({
    unit: 'mm',
    format: [paper.w, paper.h],
    orientation: paper.w > paper.h ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.setProperties({ title: job.title, author: job.composer ?? '', creator: '楽譜アプリ' });
  const renderer = new Renderer();
  let fontReady = false;
  let first = true;
  try {
    const total = job.documents.length;
    for (const [i, d] of job.documents.entries()) {
      job.onProgress?.(i, total);
      const staffCount = staffLayout(job.index, d.partIds).length;
      const mei = chunkToMei(job.index, {
        start: 0,
        end: job.index.score.measures.length,
        partIds: d.partIds,
        pitchMode: d.pitchMode,
        labels: d.partIds.length > 1 ? 'full' : 'none',
        multiRest: d.partIds.length === 1,
        pageHead: { title: job.title, subtitle: job.subtitle, composer: job.composer, partName: d.partName },
      });
      const r = await renderer.render(mei, pdfVerovioOptions(job.paper, staffCount), true);
      if (r.error || !r.pages) throw new Error(`楽譜を描けませんでした：${r.error ?? ''}`);
      for (const [pi, page] of r.pages.entries()) {
        const svg = new DOMParser().parseFromString(page, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        if (prepareSvg(svg) && !fontReady) {
          const data = await loadJapaneseFont();
          doc.addFileToVFS(`${JP_FONT}.ttf`, data);
          for (const style of ['normal', 'bold', 'italic', 'bolditalic']) doc.addFont(`${JP_FONT}.ttf`, JP_FONT, style);
          fontReady = true;
        }
        if (!first) doc.addPage([paper.w, paper.h], paper.w > paper.h ? 'landscape' : 'portrait');
        first = false;
        await doc.svg(svg, { x: 0, y: 0, width: paper.w, height: paper.h });
        doc.setFont('times', 'normal');
        doc.setFontSize(9);
        doc.text(String(pi + 1), paper.w / 2, paper.h - 8, { align: 'center' });
      }
    }
    job.onProgress?.(total, total);
  } finally {
    renderer.dispose();
  }
  return doc.output('blob');
}
