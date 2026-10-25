import { useState } from 'react';
import { getInstrument, INSTRUMENTS, partTransposition } from '../core/instruments';
import type { Score } from '../core/model/types';
import { formatInterval, parseInterval, withDirection, type Interval } from '../core/theory/interval';
import type { KeyFlavor } from '../core/theory/key';
import { intervalName, keyName } from '../core/theory/names';
import { duplicatePartAs, intervalToKey, simplifySpelling, transposeConcert } from '../core/transpose/transpose';

type Props = {
  score: Score;
  onChange: (score: Score, message: string) => void;
  onPartCreated: (partId: string) => void;
  onReset: () => void;
  onClose: () => void;
};

/** 音程：種類 × 度数（1〜8）＋オクターブ数（docs/spec.md「移調の細則」） */
const QUALITY_LABEL: Record<string, string> = { P: '完全', M: '長', m: '短', A: '増', d: '減' };
const PERFECT_DEGREES = new Set([1, 4, 5, 8]);
const qualitiesFor = (degree: number) =>
  degree === 1 ? ['P', 'A'] : PERFECT_DEGREES.has(degree) ? ['P', 'A', 'd'] : ['M', 'm', 'A', 'd'];
// 移調楽器を先に並べる
const TRANSPOSING_FIRST = [
  'clarinet-bb',
  'clarinet-a',
  'horn-f',
  'trumpet-bb',
  'alto-sax',
  'tenor-sax',
  'english-horn',
];

/** 移調パネル：モードA（実音移調）とモードB（移調楽器のパートを作る） */
export function TransposePanel({ score, onChange, onPartCreated, onReset, onClose }: Props) {
  const firstKey = score.measures[0]?.key ?? { fifths: 0, mode: 'major' as const };
  const [by, setBy] = useState<'key' | 'interval'>('key');
  const [targetFifths, setTargetFifths] = useState(firstKey.fifths);
  const [quality, setQuality] = useState('M');
  const [degree, setDegree] = useState(2);
  const [octaves, setOctaves] = useState(0);
  const intervalText = `${quality}${degree + 7 * octaves}`;
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [flavor, setFlavor] = useState<KeyFlavor>('auto');
  const [allParts, setAllParts] = useState(true);
  const [partIds, setPartIds] = useState<string[]>(score.parts.map((p) => p.id));
  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState(score.measures[0]?.displayNumber ?? '1');
  const [to, setTo] = useState(score.measures[score.measures.length - 1]?.displayNumber ?? '1');

  const [sourcePart, setSourcePart] = useState(score.parts[0]?.id ?? '');
  const [instrumentId, setInstrumentId] = useState('clarinet-bb');
  const sourceDef = getInstrument(score.parts.find((p) => p.id === sourcePart)?.instrumentId ?? 'unknown');
  const [extract, setExtract] = useState<boolean | null>(null);
  const extractValue = extract ?? (sourceDef.polyphonic && !getInstrument(instrumentId).polyphonic);

  const interval: Interval =
    by === 'key' ? intervalToKey(firstKey, targetFifths, dir) : withDirection(parseInterval(intervalText), dir);
  const target = { fifths: targetFifths, mode: firstKey.mode };

  const indexOf = (display: string) => score.measures.findIndex((m) => m.displayNumber === display.trim());
  const range = whole ? undefined : { start: Math.max(0, indexOf(from)), end: indexOf(to) + 1 };
  const rangeOk = whole || (range!.start >= 0 && range!.end > range!.start);

  function apply() {
    const r = transposeConcert(score, {
      interval,
      partIds: allParts ? undefined : partIds,
      range,
      flavor: flavor === 'auto' ? 'auto' : flavor,
    });
    const desc = interval.chromatic === 0 && interval.diatonic === 0 ? '移調なし' : describe(interval);
    onChange(r.score, `移調しました（${desc}）${r.respelled ? `。綴りを書き換えた音：${r.respelled}` : ''}`);
  }

  const keyOptions = Array.from({ length: 15 }, (_, i) => i - 7);
  const instruments = [
    ...TRANSPOSING_FIRST.map((id) => getInstrument(id)),
    ...INSTRUMENTS.filter((i) => !TRANSPOSING_FIRST.includes(i.id) && !i.unpitched && i.id !== 'unknown'),
  ];
  const transposingParts = score.parts.filter((p) => partTransposition(p));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label="移調" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>移調</h2>
          <button className="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <h3>曲の調を変える（実音移調）</h3>
        <div className="segmented" role="radiogroup" aria-label="指定のしかた">
          {(
            [
              ['key', '調を指定'],
              ['interval', '音程を指定'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={by === v ? 'on' : ''}>
              <input type="radio" name="by" checked={by === v} onChange={() => setBy(v)} />
              {label}
            </label>
          ))}
        </div>
        {by === 'key' ? (
          <label className="field">
            移調先の調
            <select
              value={targetFifths}
              onChange={(e) => setTargetFifths(Number(e.target.value))}
              aria-label="移調先の調"
            >
              {keyOptions.map((f) => (
                <option key={f} value={f}>
                  {keyName({ fifths: f, mode: firstKey.mode })}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="row">
            <label className="field">
              度数
              <select
                aria-label="度数"
                value={degree}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  setDegree(d);
                  if (!qualitiesFor(d).includes(quality)) setQuality(PERFECT_DEGREES.has(d) ? 'P' : 'M');
                }}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>
                    {d}度
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              種類
              <select aria-label="音程の種類" value={quality} onChange={(e) => setQuality(e.target.value)}>
                {qualitiesFor(degree).map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABEL[q]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              さらに
              <select aria-label="足すオクターブ" value={octaves} onChange={(e) => setOctaves(Number(e.target.value))}>
                {[0, 1, 2, 3].map((o) => (
                  <option key={o} value={o}>
                    {o === 0 ? 'なし' : `${o}オクターブ`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="row">
          <div className="segmented" role="radiogroup" aria-label="向き">
            {(
              [
                ['up', '上げる'],
                ['down', '下げる'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className={dir === v ? 'on' : ''}>
                <input type="radio" name="dir" checked={dir === v} onChange={() => setDir(v)} />
                {label}
              </label>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="調号">
            {(
              [
                ['auto', '自動'],
                ['sharp', '♯系'],
                ['flat', '♭系'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className={flavor === v ? 'on' : ''}>
                <input type="radio" name="flavor" checked={flavor === v} onChange={() => setFlavor(v)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <fieldset className="choice">
          <legend>対象</legend>
          <label className="check">
            <input type="checkbox" checked={allParts} onChange={(e) => setAllParts(e.target.checked)} />
            全パート
          </label>
          {!allParts &&
            score.parts.map((p) => (
              <label key={p.id} className="check indent">
                <input
                  type="checkbox"
                  checked={partIds.includes(p.id)}
                  onChange={(e) =>
                    setPartIds(e.target.checked ? [...partIds, p.id] : partIds.filter((x) => x !== p.id))
                  }
                />
                {p.name || p.id}
              </label>
            ))}
          <label className="check">
            <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
            曲全体
          </label>
          {!whole && (
            <div className="row indent">
              <input
                className="measure-input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="開始小節"
              />
              小節目から
              <input
                className="measure-input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="終了小節"
              />
              小節目まで
            </div>
          )}
        </fieldset>
        <p className="muted" data-testid="transpose-preview">
          {by === 'key' ? `${keyName(firstKey)} → ${keyName(target)}、` : ''}
          {describe(interval)}
          {!allParts && '（一部のパートだけのときは調号を変えず、臨時記号で書きます）'}
        </p>
        <div className="actions">
          <button className="button primary" onClick={apply} disabled={!rangeOk || (!allParts && partIds.length === 0)}>
            移調する
          </button>
        </div>

        <h3>移調楽器のパートを作る</h3>
        <p className="muted">
          元のパートは残したまま、指定した楽器のパートを作ります。上の切り替えを「記譜」にすると、その楽器の記譜（調号も）で表示されます。
        </p>
        <label className="field">
          元のパート
          <select value={sourcePart} onChange={(e) => setSourcePart(e.target.value)} aria-label="元のパート">
            {score.parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          楽器
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} aria-label="楽器">
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name.ja}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={extractValue} onChange={(e) => setExtract(e.target.checked)} />
          旋律だけを取り出す（右手のいちばん高い音を拾う）
        </label>
        <div className="actions">
          <button
            className="button primary"
            onClick={() => {
              const r = duplicatePartAs(score, { sourcePartId: sourcePart, instrumentId, extractMelody: extractValue });
              onChange(r.score, `${getInstrument(instrumentId).name.ja}のパートを作りました`);
              onPartCreated(r.partId);
            }}
          >
            パートを作る
          </button>
        </div>

        {transposingParts.length > 0 && (
          <>
            <h3>移調楽器の調号</h3>
            <p className="muted">既定は記号の少ない方（同数なら♯系）です。</p>
            {transposingParts.map((p) => (
              <label key={p.id} className="field">
                {p.name || p.id}
                <select
                  value={p.keySignatureFlavor ?? 'auto'}
                  onChange={(e) =>
                    onChange(
                      {
                        ...score,
                        parts: score.parts.map((x) =>
                          x.id === p.id ? { ...x, keySignatureFlavor: e.target.value as KeyFlavor } : x,
                        ),
                      },
                      '調号の書き方を変えました',
                    )
                  }
                >
                  <option value="auto">自動</option>
                  <option value="sharp">♯系</option>
                  <option value="flat">♭系</option>
                </select>
              </label>
            ))}
          </>
        )}

        <h3>そのほか</h3>
        <div className="actions">
          <button
            className="button"
            onClick={() => {
              const r = simplifySpelling(score);
              onChange(
                r.score,
                r.changed ? `${r.changed}個の音を異名同音で書き換えました` : '書き換える音はありませんでした',
              );
            }}
          >
            異名同音で簡単にする
          </button>
          <button className="button" onClick={onReset}>
            開いたときの状態に戻す
          </button>
        </div>
      </section>
    </div>
  );
}

/** 音程の説明：「短2度上」「完全5度下」 */
function describe(iv: Interval): string {
  const up = iv.chromatic > 0 || (iv.chromatic === 0 && iv.diatonic > 0);
  const abs = { diatonic: Math.abs(iv.diatonic), chromatic: Math.abs(iv.chromatic) };
  if (abs.diatonic === 0 && abs.chromatic === 0) return '同じ高さ';
  return `${intervalName(abs)}${up ? '上' : '下'}（${formatInterval(abs)}）`;
}
