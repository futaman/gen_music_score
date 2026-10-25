import type { Score } from '../core/model/types';
import type { DisplaySettings } from './settings';

type Props = {
  score: Score;
  settings: DisplaySettings;
  update: (patch: Partial<DisplaySettings>) => void;
  reset: () => void;
  onDownload: () => void;
  onSaveProject?: () => void;
  onClose: () => void;
};

type Option<T extends string> = { value: T; label: string };

function Choice<K extends keyof DisplaySettings>(props: {
  label: string;
  name: K;
  value: string;
  options: Option<string>[];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="choice">
      <legend>{props.label}</legend>
      <div className="segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <label key={o.value} className={props.value === o.value ? 'on' : ''}>
            <input
              type="radio"
              name={String(props.name)}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 表示オプション（設定パネル） */
export function SettingsPanel({ score, settings, update, reset, onDownload, onSaveProject, onClose }: Props) {
  const zoomValue = settings.zoom === 'fit' ? 100 : settings.zoom;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label="表示の設定" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>表示の設定</h2>
          <button className="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <Choice
          label="表示範囲"
          name="view"
          value={settings.view}
          options={[
            { value: 'score', label: '総譜' },
            { value: 'part', label: 'パート譜' },
            { value: 'selected', label: '選んだパート' },
          ]}
          onChange={(v) => update({ view: v as DisplaySettings['view'] })}
        />
        {settings.view === 'part' && (
          <label className="field">
            パート
            <select value={settings.partId ?? score.parts[0]?.id} onChange={(e) => update({ partId: e.target.value })}>
              {score.parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>
        )}
        {settings.view === 'selected' && (
          <fieldset className="choice">
            <legend>表示するパート</legend>
            {score.parts.map((p) => {
              const sel = settings.selectedPartIds ?? score.parts.map((x) => x.id);
              return (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    checked={sel.includes(p.id)}
                    onChange={(e) =>
                      update({ selectedPartIds: e.target.checked ? [...sel, p.id] : sel.filter((id) => id !== p.id) })
                    }
                  />
                  {p.name || p.id}
                </label>
              );
            })}
          </fieldset>
        )}

        <Choice
          label="音の高さ"
          name="pitchMode"
          value={settings.pitchMode}
          options={[
            { value: 'written', label: '移調（記譜音）' },
            { value: 'concert', label: '実音' },
          ]}
          onChange={(v) => update({ pitchMode: v as DisplaySettings['pitchMode'] })}
        />
        <Choice
          label="レイアウト"
          name="layout"
          value={settings.layout}
          options={[
            { value: 'page', label: 'ページ' },
            { value: 'horizontal', label: '横に続く1段' },
            { value: 'vertical', label: '縦に連続' },
          ]}
          onChange={(v) => update({ layout: v as DisplaySettings['layout'] })}
        />
        <fieldset className="choice">
          <legend>拡大率</legend>
          <div className="row">
            <input
              type="range"
              min={50}
              max={200}
              step={10}
              value={zoomValue}
              aria-label="拡大率"
              onChange={(e) => update({ zoom: Number(e.target.value) })}
            />
            <span className="zoom-value">{settings.zoom === 'fit' ? '画面幅' : `${settings.zoom}%`}</span>
            <button className="button" onClick={() => update({ zoom: 'fit' })} disabled={settings.zoom === 'fit'}>
              画面幅に合わせる
            </button>
          </div>
        </fieldset>
        <Choice
          label="音名"
          name="noteNames"
          value={settings.noteNames}
          options={[
            { value: 'none', label: 'なし' },
            { value: 'doremi', label: 'ドレミ' },
            { value: 'english', label: 'CDE' },
            { value: 'german', label: 'ツェーデー' },
          ]}
          onChange={(v) => update({ noteNames: v as DisplaySettings['noteNames'] })}
        />
        <Choice
          label="続く全休符"
          name="multiRest"
          value={settings.multiRest ? 'on' : 'off'}
          options={[
            { value: 'off', label: '1小節ずつ' },
            { value: 'on', label: '数字付きでまとめる' },
          ]}
          onChange={(v) => update({ multiRest: v === 'on' })}
        />
        <Choice
          label="小節番号"
          name="measureNumbers"
          value={settings.measureNumbers}
          options={[
            { value: 'system', label: '各段の頭' },
            { value: 'every', label: '毎小節' },
            { value: 'five', label: '5小節ごと' },
            { value: 'none', label: 'なし' },
          ]}
          onChange={(v) => update({ measureNumbers: v as DisplaySettings['measureNumbers'] })}
        />
        <Choice
          label="色分け"
          name="colorBy"
          value={settings.colorBy}
          options={[
            { value: 'none', label: 'なし' },
            { value: 'instrument', label: '楽器ごと' },
          ]}
          onChange={(v) => update({ colorBy: v as DisplaySettings['colorBy'] })}
        />
        <Choice
          label="ホルンの調号"
          name="hornKeySignature"
          value={settings.hornKeySignature}
          options={[
            { value: 'with', label: '調号あり' },
            { value: 'without', label: '調号なし（臨時記号）' },
          ]}
          onChange={(v) => update({ hornKeySignature: v as DisplaySettings['hornKeySignature'] })}
        />
        <Choice
          label="警告ハイライト"
          name="warnings"
          value={settings.warnings ? 'on' : 'off'}
          options={[
            { value: 'on', label: '表示' },
            { value: 'off', label: '非表示' },
          ]}
          onChange={(v) => update({ warnings: v === 'on' })}
        />
        <Choice
          label="再生中の追従"
          name="follow"
          value={settings.follow ? 'on' : 'off'}
          options={[
            { value: 'on', label: '自動スクロールする' },
            { value: 'off', label: 'しない' },
          ]}
          onChange={(v) => update({ follow: v === 'on' })}
        />
        <Choice
          label="配色"
          name="theme"
          value={settings.theme}
          options={[
            { value: 'system', label: '端末に合わせる' },
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
          ]}
          onChange={(v) => update({ theme: v as DisplaySettings['theme'] })}
        />
        <p className="muted">手直しした音の印・編曲元パートごとの色分けは、それぞれの機能を作るときに足します。</p>
        <div className="actions">
          <button className="button" onClick={reset}>
            既定に戻す
          </button>
        </div>
        <h3>書き出し</h3>
        <div className="actions">
          <button className="button" onClick={onDownload}>
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
