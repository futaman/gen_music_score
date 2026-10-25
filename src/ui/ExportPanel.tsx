import { useState } from 'react';
import type { ScoreIndex } from '../core/model/scoreIndex';
import type { PaperSize, PdfDocument } from '../pdf/pdf';
import type { DisplaySettings } from './settings';

type Props = {
  index: ScoreIndex;
  name: string;
  /** 総譜の PDF は、いま表示しているパートと音の高さで作る */
  shownPartIds: string[];
  settings: DisplaySettings;
  onDownloadMusicXml: () => void;
  onSaveProject?: () => void;
  onClose: () => void;
};

const PAPER_OPTIONS: [PaperSize, string][] = [
  ['a4', 'A4 縦'],
  ['b4', 'B4 縦'],
  ['a3', 'A3 縦'],
  ['a4-landscape', 'A4 横'],
  ['letter', 'レター 縦'],
];

const safeName = (s: string) => s.replace(/\.(mxl|musicxml|xml)$/i, '').replace(/[\\/:*?"<>|]/g, '_') || '楽譜';

function save(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  // ページに置いてから押す（置かないと、ブラウザによってはファイル名が付かない）
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 書き出し：PDF（総譜・パート譜）、MusicXML、プロジェクトのファイル */
export function ExportPanel({
  index,
  name,
  shownPartIds,
  settings,
  onDownloadMusicXml,
  onSaveProject,
  onClose,
}: Props) {
  const { score } = index;
  const [kind, setKind] = useState<'parts' | 'score'>('parts');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(score.parts.map((p) => p.id)));
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const makePdf = async () => {
    setError(null);
    const documents: PdfDocument[] =
      kind === 'score'
        ? [{ partIds: shownPartIds, pitchMode: settings.pitchMode }]
        : score.parts
            .filter((p) => selected.has(p.id))
            .map((p) => ({ partIds: [p.id], partName: p.name, pitchMode: 'written' as const }));
    if (documents.length === 0 || documents[0].partIds.length === 0) {
      setError('パートを選んでください。');
      return;
    }
    setProgress('準備中…');
    try {
      const pdf = await import('../pdf/pdf');
      const blob = await pdf.makePdf({
        index,
        paper,
        title: score.title || name,
        subtitle: score.movementTitle,
        composer: score.composer,
        documents,
        onProgress: (done, total) => setProgress(total > 1 ? `作成中…（${done}/${total}）` : '作成中…'),
      });
      const suffix = kind === 'score' ? '' : documents.length === 1 ? `-${documents[0].partName}` : '-パート譜';
      save(blob, `${safeName(name)}${suffix}.pdf`.replace(/[\\/:*?"<>|]/g, '_'));
    } catch (e) {
      setError(`PDFを作れませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label="書き出し" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>書き出し</h2>
          <button className="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <h3>PDF（印刷用）</h3>
        <fieldset className="choice">
          <legend>内容</legend>
          <div className="segmented" role="radiogroup" aria-label="内容">
            <label className={kind === 'parts' ? 'on' : ''}>
              <input type="radio" name="pdf-kind" checked={kind === 'parts'} onChange={() => setKind('parts')} />
              パート譜
            </label>
            <label className={kind === 'score' ? 'on' : ''}>
              <input type="radio" name="pdf-kind" checked={kind === 'score'} onChange={() => setKind('score')} />
              総譜
            </label>
          </div>
          <p className="muted">
            {kind === 'parts'
              ? 'パートごとに記譜音で、続く全休符はまとめます。'
              : `いま表示しているパートを、${settings.pitchMode === 'written' ? '記譜音' : '実音'}で。`}
          </p>
        </fieldset>
        {kind === 'parts' && (
          <fieldset className="choice checks">
            <legend>パート</legend>
            {score.parts.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setSelected(next);
                  }}
                />
                {p.name || p.id}
              </label>
            ))}
          </fieldset>
        )}
        <label className="field">
          用紙
          <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
            {PAPER_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="button primary" onClick={() => void makePdf()} disabled={!!progress}>
            {progress ?? 'PDFを作る'}
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}

        <h3>ほかのソフト・ほかの端末へ</h3>
        <div className="actions">
          <button className="button" onClick={onDownloadMusicXml}>
            MusicXMLとして書き出す
          </button>
          {onSaveProject && (
            <button className="button" onClick={onSaveProject}>
              プロジェクトをファイルに保存
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
