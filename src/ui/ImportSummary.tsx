import { getInstrument, partTransposition } from '../core/instruments';
import { exportMusicXml } from '../core/musicxml/export';
import type { ImportResult } from '../core/musicxml/file';
import { keyName, transpositionName } from '../core/theory/names';

type Props = { fileName: string; result: ImportResult; ms: number };

/** 読み込み確認：パート・楽器・調号・拍子・小節数と、警告・無視した要素の一覧 */
export function ImportSummary({ fileName, result, ms }: Props) {
  const { score, warnings, ignored, software } = result;
  const first = score.measures[0];
  const keyChanges = score.measures.filter((m, i) => i > 0 && m.key).length;
  const timeChanges = score.measures.filter((m, i) => i > 0 && m.time).length;
  const unexpected = ignored.filter((i) => !i.expected);
  const expected = ignored.filter((i) => i.expected);

  function download() {
    const xml = exportMusicXml(score);
    const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.(mxl|musicxml|xml)$/i, '') + '.musicxml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <section aria-label="読み込み結果">
      <h2>{score.title || '（曲名なし）'}</h2>
      <dl className="summary">
        <dt>作曲者</dt>
        <dd>{score.composer || '—'}</dd>
        {score.movementTitle && (
          <>
            <dt>楽章</dt>
            <dd>{score.movementTitle}</dd>
          </>
        )}
        <dt>調号（実音）</dt>
        <dd>
          {first?.key ? keyName(first.key) : '—'}
          {keyChanges > 0 && <span className="muted"> ・途中で{keyChanges}回変わる</span>}
        </dd>
        <dt>拍子</dt>
        <dd>
          {first?.time ? `${first.time.beats}/${first.time.beatType}` : '—'}
          {timeChanges > 0 && <span className="muted"> ・途中で{timeChanges}回変わる</span>}
        </dd>
        <dt>小節数</dt>
        <dd data-testid="measure-count">{score.measures.length}</dd>
        <dt>音符の数</dt>
        <dd>{score.notes.filter((n) => n.heads.length).length}</dd>
        <dt>作成ソフト</dt>
        <dd>{software ?? '—'}</dd>
      </dl>
      <p className="muted">読み込み時間 {Math.round(ms)}ms</p>

      <h2>パート（{score.parts.length}）</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>パート名</th>
              <th>楽器</th>
              <th>移調</th>
              <th>段数</th>
            </tr>
          </thead>
          <tbody>
            {score.parts.map((p) => (
              <tr key={p.id}>
                <td>{p.name || p.id}</td>
                <td>{getInstrument(p.instrumentId).name.ja}</td>
                <td>{transpositionName(partTransposition(p))}</td>
                <td>{p.staves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {warnings.length > 0 && (
        <>
          <h2>警告（{warnings.length}）</h2>
          <div className="notice warn">
            <ul className="compact">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      {unexpected.length > 0 && (
        <>
          <h2>読み込まなかった要素</h2>
          <p className="muted">対応していない記号です。楽譜の表示・再生には使いません。</p>
          <ul className="compact">
            {unexpected.map((i) => (
              <li key={i.name}>
                {i.name}（{i.count}か所）
              </li>
            ))}
          </ul>
        </>
      )}
      {expected.length > 0 && (
        <details>
          <summary className="muted">レイアウト情報など、意図して使わない要素（{expected.length}種類）</summary>
          <ul className="compact">
            {expected.map((i) => (
              <li key={i.name}>
                {i.name}（{i.count}か所）
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="actions">
        <button className="button" onClick={download}>
          MusicXMLとして書き出す
        </button>
      </div>
    </section>
  );
}
