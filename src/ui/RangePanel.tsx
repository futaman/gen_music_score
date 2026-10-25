import type { RangeIssue } from '../core/check/range';
import { getInstrument } from '../core/instruments';
import type { Score } from '../core/model/types';
import { formatPitch } from '../core/theory/pitch';

type Props = {
  score: Score;
  issues: RangeIssue[];
  onFix: (issues: RangeIssue[]) => void;
  onJump: (measure: number) => void;
  onClose: () => void;
};

const octaveText = (o: number) => (o > 0 ? `${o}オクターブ上げる` : `${-o}オクターブ下げる`);

/** 音域外の音の一覧。候補どおりにオクターブを動かせる */
export function RangePanel({ score, issues, onFix, onJump, onClose }: Props) {
  const byPart = score.parts
    .map((p) => ({ part: p, list: issues.filter((i) => i.partId === p.id) }))
    .filter((x) => x.list.length);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label="音域外の音" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>音域外の音（{issues.length}）</h2>
          <button className="button" onClick={onClose}>
            閉じる
          </button>
        </header>
        {issues.length === 0 && <p>音域外の音はありません。</p>}
        {byPart.map(({ part, list }) => {
          const def = getInstrument(part.instrumentId);
          const fixable = list.filter((i) => i.suggestOctaves !== null);
          return (
            <section key={part.id}>
              <h3>
                {part.name || part.id}
                <span className="muted">
                  （{def.name.ja}・実音 {formatPitch(def.range.practical[0])}〜{formatPitch(def.range.practical[1])}）
                </span>
              </h3>
              {fixable.length > 1 && (
                <button className="button" onClick={() => onFix(fixable)}>
                  このパートの{fixable.length}音を候補どおりに直す
                </button>
              )}
              <ul className="issues">
                {list.slice(0, 200).map((i) => (
                  <li key={i.headId}>
                    <button className="link" onClick={() => onJump(i.measure)}>
                      {score.measures[i.measure]?.displayNumber}小節目
                    </button>
                    <span>
                      {formatPitch(i.pitch)}（{i.kind === 'high' ? '高すぎる' : '低すぎる'}）
                    </span>
                    {i.suggestOctaves !== null ? (
                      <button className="button" onClick={() => onFix([i])}>
                        {octaveText(i.suggestOctaves)}
                      </button>
                    ) : (
                      <span className="muted">オクターブを動かしても入りません</span>
                    )}
                  </li>
                ))}
              </ul>
              {list.length > 200 && <p className="muted">ほか {list.length - 200} 音</p>}
            </section>
          );
        })}
      </section>
    </div>
  );
}
