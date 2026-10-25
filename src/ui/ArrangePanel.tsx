import { useState } from 'react';
import type { ArrangeWarning } from '../core/arrange/check';
import { ensembleName } from '../core/arrange/workspace';
import { ENSEMBLES, getInstrument } from '../core/instruments';
import type { Arrangement, Role, Score } from '../core/model/types';

const ROLE_LABEL: Record<Role, string> = {
  'melody-high': '旋律（高）',
  'melody-mid': '旋律（中）',
  counter: '対旋律',
  harmony: '和声',
  bass: 'バス',
  rest: '休み',
  double: '重複',
};

type Props = {
  /** いま開いている楽譜 */
  score: Score;
  /** 編曲で作った楽譜を開いているときだけ */
  arrangement?: Arrangement;
  source?: Score;
  warnings: ArrangeWarning[];
  initialTab?: 'table' | 'warnings';
  onCreate?: (ensembleId: string, rotateMelody: boolean) => void;
  onReassign: (sectionId: string, instrument?: string, unitIds?: string[]) => void;
  onDelete?: () => void;
  onJump: (measure: number, partId?: string) => void;
  onClose: () => void;
};

/** 元の単位（partId か partId#段）の表示名 */
function unitLabel(source: Score, unitId: string): string {
  const [pid, staff] = unitId.split('#');
  const p = source.parts.find((x) => x.id === pid);
  const name = p?.name || pid;
  return staff ? `${name}（${staff}段目）` : name;
}

/** 編曲：編曲案を作る／割当表を直す／警告の一覧 */
export function ArrangePanel(props: Props) {
  const { score, arrangement, source, warnings } = props;
  const [tab, setTab] = useState<'table' | 'warnings'>(props.initialTab ?? 'table');
  const [ensembleId, setEnsembleId] = useState(ENSEMBLES[0]?.id ?? '');
  const [rotate, setRotate] = useState(true);
  const m = (i: number) => score.measures[i]?.displayNumber ?? String(i + 1);

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <section className="sheet arrange" role="dialog" aria-label="編曲" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>{arrangement ? `編曲：${ensembleName(arrangement)}` : '編曲'}</h2>
          <button className="button" onClick={props.onClose}>
            閉じる
          </button>
        </header>

        {!arrangement || !source ? (
          <>
            <p className="muted">
              元の楽譜から、編成の楽器への割当案と楽譜を自動で作ります。できた楽譜は「元の楽譜」とは別に保存され、割当表で直せます。
            </p>
            <label className="field">
              編成
              <select value={ensembleId} onChange={(e) => setEnsembleId(e.target.value)}>
                {ENSEMBLES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}（{e.instruments.map((i) => getInstrument(i).name.ja).join('・')}）
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
              旋律を受け持つ楽器を区間ごとに回す（同じ楽器が続きすぎないように）
            </label>
            <div className="actions">
              <button className="button primary" onClick={() => props.onCreate?.(ensembleId, rotate)}>
                編曲案を作る
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="segmented" role="tablist" aria-label="表示">
              <label className={tab === 'table' ? 'on' : ''}>
                <input type="radio" name="arrange-tab" checked={tab === 'table'} onChange={() => setTab('table')} />
                割当表
              </label>
              <label className={tab === 'warnings' ? 'on' : ''}>
                <input
                  type="radio"
                  name="arrange-tab"
                  checked={tab === 'warnings'}
                  onChange={() => setTab('warnings')}
                />
                警告 {warnings.length}
              </label>
            </div>

            {tab === 'table' ? (
              <>
                <p className="muted">
                  区間ごとに、どの楽器がどのパートを吹くかを選びます。変えた楽器だけ作り直し、手で直した小節はそのまま残します。
                </p>
                <div className="table-scroll">
                  <table className="arrange-table">
                    <thead>
                      <tr>
                        <th>小節</th>
                        {score.parts.map((p) => (
                          <th key={p.id}>{p.abbr || p.name}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {arrangement.sections.map((sec) => {
                        const units = Object.keys(sec.roles);
                        return (
                          <tr key={sec.id}>
                            <th scope="row">
                              <button className="link" onClick={() => props.onJump(sec.start)}>
                                {m(sec.start)}–{m(sec.end - 1)}
                              </button>
                            </th>
                            {score.parts.map((p) => {
                              const cur = sec.mapping[p.id]?.[0] ?? '';
                              return (
                                <td key={p.id}>
                                  <select
                                    aria-label={`${m(sec.start)}小節からの${p.name}`}
                                    value={cur}
                                    onChange={(e) =>
                                      props.onReassign(sec.id, p.id, e.target.value ? [e.target.value] : [])
                                    }
                                  >
                                    <option value="">休み</option>
                                    {units.map((u) => (
                                      <option key={u} value={u}>
                                        {unitLabel(source, u)}・{ROLE_LABEL[sec.roles[u]]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            })}
                            <td>
                              <button
                                className="button"
                                title="この区間の全楽器を割当表どおりに作り直す（手で直した小節は残す）"
                                onClick={() => props.onReassign(sec.id)}
                              >
                                作り直す
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {props.onDelete && (
                  <div className="actions">
                    <button
                      className="button"
                      onClick={() => {
                        if (confirm('この編曲（作った楽譜と割当表）を削除しますか？元に戻せません。'))
                          props.onDelete?.();
                      }}
                    >
                      この編曲を削除
                    </button>
                  </div>
                )}
              </>
            ) : warnings.length === 0 ? (
              <p>警告はありません。</p>
            ) : (
              <ul className="issues">
                {warnings.map((w, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => props.onJump(w.start, w.partId)}>
                      {m(w.start)}
                      {w.end - 1 > w.start ? `–${m(w.end - 1)}` : ''}小節・
                      {score.parts.find((p) => p.id === w.partId)?.name ??
                        source.parts.find((p) => p.id === w.partId)?.name}
                    </button>
                    ：{w.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
