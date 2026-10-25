import { unzipSync, strFromU8 } from 'fflate';
import { splitMusicXml, type Chunk } from './chunk';
import type { WorkerRequest, WorkerResponse } from './worker';

type ChunkView = Chunk & { el: HTMLElement; rendered: boolean; requested: boolean };
type Timing = { kind: 'pitch' | 'relayout'; ms: number; workerMs: number; roundTripMs: number; domMs: number; path: string };

declare global {
  interface Window {
    __bench: { ready: boolean; loadMs: number; firstPaintMs: number; timings: Timing[]; chunks: number; error?: string };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scoreEl = $('score');
const statusEl = $('status');
const timingEl = $('timing');
const selectedEl = $('selected');
const params = new URLSearchParams(location.search);

window.__bench = { ready: false, loadMs: 0, firstPaintMs: 0, timings: [], chunks: 0 };

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const send = (m: WorkerRequest) => worker.postMessage(m);
let reqSeq = 0;
type RenderResult = Exclude<WorkerResponse, { type: 'ready' }>;
const pending = new Map<number, (r: RenderResult) => void>();
let workerReady: Promise<void>;

let chunks: ChunkView[] = [];
let selection: { chunk: number; id: string } | null = null;
let observer: IntersectionObserver | null = null;

const SCALE = Number(params.get('scale') ?? 35);

function initWorker() {
  workerReady = new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'ready') {
        console.log(`verovio ${m.version} ready in ${m.ms | 0}ms`);
        resolve();
      } else {
        pending.get(m.reqId)?.(m);
        pending.delete(m.reqId);
      }
    };
  });
  const width = Math.max(320, scoreEl.clientWidth);
  send({
    type: 'init',
    options: {
      pageWidth: Math.round((width * 100) / SCALE),
      pageHeight: 60000,
      adjustPageHeight: true,
      scale: SCALE,
      breaks: 'auto',
      header: 'none',
      footer: 'none',
      pageMarginTop: 20,
      pageMarginBottom: 20,
      pageMarginLeft: 20,
      pageMarginRight: 20,
    },
  });
}

function request(m: Omit<Extract<WorkerRequest, { type: 'render' }>, 'reqId'> | Omit<Extract<WorkerRequest, { type: 'editPitch' }>, 'reqId'>) {
  const reqId = ++reqSeq;
  return new Promise<RenderResult>((resolve) => {
    pending.set(reqId, resolve);
    send({ ...m, reqId } as WorkerRequest);
  });
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function fetchMusicXml(path: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(path)).arrayBuffer());
  return decodeMusicXml(buf, path);
}

function decodeMusicXml(buf: Uint8Array, name: string): string {
  if (!name.endsWith('.mxl')) return new TextDecoder().decode(buf);
  const files = unzipSync(buf);
  const container = strFromU8(files['META-INF/container.xml']);
  const root = container.match(/full-path="([^"]+)"/)?.[1];
  if (!root || !files[root]) throw new Error('.mxl の中に楽譜ファイルが見つかりません');
  return strFromU8(files[root]);
}

// id のない <note> に id を振る（SVGの要素と音符を対応させるため）
function assignNoteIds(xml: string): string {
  let n = 0;
  return xml.replace(/<note(\s[^>]*)?>/g, (tag, attrs = '') => (/\bid=/.test(attrs) ? tag : `<note id="n${n++}"${attrs}>`));
}

async function load(xml: string) {
  const t0 = performance.now();
  window.__bench.ready = false;
  statusEl.textContent = '分割中…';
  observer?.disconnect();
  scoreEl.innerHTML = '';
  selection = null;
  updateToolbar();
  await workerReady;
  const size = Number(($('size') as HTMLSelectElement).value);
  const tSplit = performance.now();
  const raw = splitMusicXml(assignNoteIds(xml), size, new DOMParser(), new XMLSerializer());
  const splitMs = performance.now() - tSplit;
  chunks = raw.map((c, i) => {
    const el = document.createElement('section');
    el.className = 'chunk';
    el.dataset.chunk = String(i);
    el.innerHTML = `<div class="placeholder" style="height:${estimateHeight(c.xml)}px">小節 ${c.start + 1}〜${c.end}</div>`;
    scoreEl.appendChild(el);
    return { ...c, el, rendered: false, requested: false };
  });
  window.__bench.chunks = chunks.length;
  // 表示中のチャンクだけ描画する
  observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) if (en.isIntersecting) renderChunk(Number((en.target as HTMLElement).dataset.chunk));
    },
    { rootMargin: '800px 0px' },
  );
  chunks.forEach((c) => observer!.observe(c.el));
  // 最初の画面ぶんが描けるまで待つ
  const firstVisible = chunks.filter((c) => c.el.getBoundingClientRect().top < innerHeight + 800);
  await Promise.all(firstVisible.map((c) => renderChunk(chunks.indexOf(c))));
  await nextPaint();
  const total = performance.now() - t0;
  window.__bench.firstPaintMs = total;
  window.__bench.ready = true;
  statusEl.textContent = `${chunks.length}チャンク／分割 ${splitMs | 0}ms／最初の表示まで ${total | 0}ms`;
}

// 描画結果を画面に反映する。小節だけの結果なら、その <g class="measure"> だけ差し替える
function applyResult(c: ChunkView, r: RenderResult) {
  if (r.type === 'svg') {
    c.el.innerHTML = r.svg;
    return;
  }
  const svg = c.el.querySelector('svg');
  const oldSvgId = svg?.id;
  // グリフ定義（<defs> 内の "E0A4-<svgId>" など）の接尾辞を、表示中のSVGのものに合わせる
  const frag = r.fragment.split(`-${r.svgId}"`).join(`-${oldSvgId}"`);
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${frag}</svg>`, 'image/svg+xml');
  const next = doc.documentElement.firstElementChild!;
  const prev = svg && c.el.querySelector(`g.measure[id="${next.id}"]`);
  const defs = svg?.querySelector('defs');
  const missingGlyph = Array.from(next.querySelectorAll('use')).some((u) => {
    const href = u.getAttribute('xlink:href') ?? u.getAttribute('href') ?? '';
    return !defs?.querySelector(`#${CSS.escape(href.slice(1))}`);
  });
  if (!prev || missingGlyph) {
    // 使うグリフが表示中のSVGにない → チャンクごと描き直す
    c.rendered = false;
    renderChunk(chunks.indexOf(c));
    return;
  }
  prev.replaceWith(document.importNode(next, true));
}

function estimateHeight(xml: string) {
  const parts = (xml.match(/<part /g) ?? []).length;
  return Math.max(120, parts * 70 * (SCALE / 40));
}

const inflight = new Map<number, Promise<void>>();
function renderChunk(i: number): Promise<void> {
  const c = chunks[i];
  if (c.rendered) return Promise.resolve();
  if (inflight.has(i)) return inflight.get(i)!;
  const p = request({ type: 'render', chunk: i, xml: c.xml }).then((r) => {
    applyResult(c, r);
    c.rendered = true;
    inflight.delete(i);
  });
  inflight.set(i, p);
  return p;
}

// ---- 選択と編集 ----

scoreEl.addEventListener('click', (e) => {
  const g = (e.target as Element).closest('g.note');
  const sec = (e.target as Element).closest('section.chunk') as HTMLElement | null;
  if (!g || !sec) return;
  select(Number(sec.dataset.chunk), g.id);
});

function select(chunk: number, id: string) {
  scoreEl.querySelectorAll('g.note.selected').forEach((n) => n.classList.remove('selected'));
  selection = { chunk, id };
  highlight();
  updateToolbar();
}

function highlight() {
  if (selection) chunks[selection.chunk].el.querySelector(`g.note[id="${selection.id}"]`)?.classList.add('selected');
}

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
function notePattern(id: string) {
  return new RegExp(`(<note id="${id}"[^>]*>(?:(?!</note>).)*?<pitch>\\s*<step>)([A-G])(</step>\\s*(?:<alter>-?\\d+</alter>\\s*)?<octave>)(-?\\d+)(</octave>)`, 's');
}

function readPitch(chunk: number, id: string) {
  const m = chunks[chunk].xml.match(notePattern(id));
  return m ? { step: m[2], octave: Number(m[4]) } : null;
}

function updateToolbar() {
  const p = selection && readPitch(selection.chunk, selection.id);
  selectedEl.textContent = p ? `選択中：${p.step}${p.octave}` : selection ? '休符' : '音符をタップして選択';
  for (const id of ['up', 'down', 'dur']) ($(id) as HTMLButtonElement).disabled = !p;
}

async function movePitch(dir: 1 | -1) {
  if (!selection) return;
  const t0 = performance.now();
  const { chunk, id } = selection;
  const p = readPitch(chunk, id);
  if (!p) return;
  let si = STEPS.indexOf(p.step) + dir;
  let oct = p.octave;
  if (si > 6) (si = 0), oct++;
  if (si < 0) (si = 6), oct--;
  const c = chunks[chunk];
  c.xml = c.xml.replace(notePattern(id), `$1${STEPS[si]}$3${oct}$5`);
  const measureId = c.el.querySelector(`g.note[id="${id}"]`)?.closest('g.measure')?.id;
  const r = await request({ type: 'editPitch', chunk, xml: c.xml, noteId: id, pname: STEPS[si].toLowerCase(), oct, measureId });
  const t1 = performance.now();
  applyResult(c, r);
  highlight();
  updateToolbar();
  const t2 = performance.now();
  await nextPaint();
  record({ kind: 'pitch', ms: performance.now() - t0, workerMs: r.ms, roundTripMs: t1 - t0, domMs: t2 - t1, path: r.path });
}

// 臨時記号の付け外し（音符の幅が変わるので再レイアウトが必要な編集の代表）
async function toggleAccidental() {
  if (!selection) return;
  const t0 = performance.now();
  const { chunk, id } = selection;
  const c = chunks[chunk];
  const re = new RegExp(`(<note id="${id}"[^>]*>(?:(?!</note>).)*?<pitch>\\s*<step>[A-G]</step>)(\\s*<alter>1</alter>)?`, 's');
  c.xml = c.xml.replace(re, (_m, head, alter) => (alter ? head : `${head}<alter>1</alter>`));
  const r = await request({ type: 'render', chunk, xml: c.xml });
  const t1 = performance.now();
  applyResult(c, r);
  highlight();
  const t2 = performance.now();
  await nextPaint();
  record({ kind: 'relayout', ms: performance.now() - t0, workerMs: r.ms, roundTripMs: t1 - t0, domMs: t2 - t1, path: r.path });
}

function record(t: Timing) {
  window.__bench.timings.push(t);
  timingEl.textContent = `${t.kind === 'pitch' ? '音高' : '再レイアウト'}：${t.ms | 0}ms（描画 ${t.workerMs | 0}ms・${t.path}）`;
}

$('up').addEventListener('click', () => movePitch(1));
$('down').addEventListener('click', () => movePitch(-1));
$('dur').addEventListener('click', () => toggleAccidental());
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') (e.preventDefault(), movePitch(1));
  if (e.key === 'ArrowDown') (e.preventDefault(), movePitch(-1));
});

// ---- 起動 ----

async function loadPath(path: string) {
  const t = performance.now();
  try {
    const xml = await fetchMusicXml(path);
    await load(xml);
    window.__bench.loadMs = performance.now() - t;
  } catch (err) {
    window.__bench.error = String(err);
    statusEl.textContent = `読み込めませんでした：${err}`;
  }
}

const fileSel = $('file') as HTMLSelectElement;
if (params.get('file')) fileSel.value = params.get('file')!;
if (params.get('size')) ($('size') as HTMLSelectElement).value = params.get('size')!;
fileSel.addEventListener('change', () => loadPath(fileSel.value));
$('size').addEventListener('change', () => loadPath(fileSel.value));
($('local') as HTMLInputElement).addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    await load(decodeMusicXml(new Uint8Array(await f.arrayBuffer()), f.name));
  } catch (err) {
    statusEl.textContent = `読み込めませんでした：${err}`;
  }
});

initWorker();
loadPath(fileSel.value);
