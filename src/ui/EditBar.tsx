import type { Selection } from '../core/edit/commands';
import type { NoteType, Score } from '../core/model/types';
import { keyName } from '../core/theory/names';

export type EditAction =
  | { type: 'pitch'; how: 'semitone-up' | 'semitone-down' | 'octave-up' | 'octave-down' | 'enharmonic' }
  | { type: 'duration'; value: NoteType }
  | { type: 'dot' }
  | { type: 'triplet' }
  | { type: 'rest' }
  | { type: 'tie' }
  | { type: 'slur' }
  | { type: 'artic'; name: string }
  | { type: 'dynamic'; value: string | null }
  | { type: 'keyboard' }
  | { type: 'range' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'clear' }
  | { type: 'range-octave'; octaves: number }
  | { type: 'move-to'; partId: string }
  | { type: 'insert-measure' }
  | { type: 'delete-measures' }
  | { type: 'time'; beats: number; beatType: number }
  | { type: 'key'; fifths: number }
  | { type: 'deselect' };

type Props = {
  score: Score;
  selection: Selection;
  rangeMode: boolean;
  slurPending: boolean;
  keyboardOpen: boolean;
  canPaste: boolean;
  onAction: (a: EditAction) => void;
};

const DURATIONS: [NoteType, string][] = [
  ['whole', '全'],
  ['half', '2分'],
  ['quarter', '4分'],
  ['eighth', '8分'],
  ['16th', '16分'],
  ['32nd', '32分'],
];
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz', 'fp'];
const ARTICS: [string, string][] = [
  ['staccato', 'スタッカート'],
  ['accent', 'アクセント'],
  ['tenuto', 'テヌート'],
  ['fermata', 'フェルマータ'],
];
const TIMES: [number, number][] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [2, 2],
  [3, 8],
  [6, 8],
  [9, 8],
  [12, 8],
];

/** 選んでいるものに合わせた編集ボタン（画面の下、再生バーの上） */
export function EditBar({ score, selection, rangeMode, slurPending, keyboardOpen, canPaste, onAction }: Props) {
  const b = (label: string, action: EditAction, opts: { on?: boolean; title?: string } = {}) => (
    <button
      key={label}
      className={`button${opts.on ? ' primary' : ''}`}
      aria-pressed={opts.on}
      title={opts.title}
      onClick={() => onAction(action)}
    >
      {label}
    </button>
  );
  const sep = (k: string) => <span key={k} className="sep" aria-hidden />;

  const items =
    selection.kind === 'note'
      ? [
          b('▲', { type: 'pitch', how: 'semitone-up' }, { title: '半音上げる（↑）' }),
          b('▼', { type: 'pitch', how: 'semitone-down' }, { title: '半音下げる（↓）' }),
          b('8va↑', { type: 'pitch', how: 'octave-up' }, { title: 'オクターブ上げる（Ctrl+↑）' }),
          b('8va↓', { type: 'pitch', how: 'octave-down' }, { title: 'オクターブ下げる（Ctrl+↓）' }),
          b('♯♭', { type: 'pitch', how: 'enharmonic' }, { title: '異名同音（J）' }),
          sep('s1'),
          ...DURATIONS.map(([t, label]) => b(label, { type: 'duration', value: t })),
          b('付点', { type: 'dot' }, { title: '付点（.）' }),
          b('3連', { type: 'triplet' }, { title: '3連符（Ctrl+3）' }),
          sep('s2'),
          b('休符', { type: 'rest' }, { title: '休符にする（Delete）' }),
          b('タイ', { type: 'tie' }, { title: 'タイ（T）' }),
          b(
            slurPending ? 'スラー：終わりの音を選ぶ' : 'スラー',
            { type: 'slur' },
            { on: slurPending, title: 'スラー（S）' },
          ),
          ...ARTICS.map(([name, label]) => b(label, { type: 'artic', name })),
          <select
            key="dyn"
            aria-label="強弱"
            value=""
            onChange={(e) => onAction({ type: 'dynamic', value: e.target.value === 'none' ? null : e.target.value })}
          >
            <option value="" disabled>
              強弱
            </option>
            {DYNAMICS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="none">強弱を消す</option>
          </select>,
          sep('s3'),
          b('鍵盤', { type: 'keyboard' }, { on: keyboardOpen }),
          b(
            '範囲',
            { type: 'range' },
            { on: rangeMode, title: '次にタップしたところまでを範囲にする（Shift+クリック）' },
          ),
          b('×', { type: 'deselect' }, { title: '選択を外す（Esc）' }),
        ]
      : [
          b('コピー', { type: 'copy' }),
          b(
            '貼り付け',
            { type: 'paste' },
            { title: canPaste ? '選んだ範囲の頭から上書き' : 'コピーしたものがありません' },
          ),
          b('消す', { type: 'clear' }),
          b('8va↑', { type: 'range-octave', octaves: 1 }),
          b('8va↓', { type: 'range-octave', octaves: -1 }),
          selection.partIds.length === 1 ? (
            <select
              key="move"
              aria-label="別の楽器へ移す"
              value=""
              onChange={(e) => onAction({ type: 'move-to', partId: e.target.value })}
            >
              <option value="" disabled>
                別の楽器へ移す
              </option>
              {score.parts
                .filter((p) => p.id !== selection.partIds[0])
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
            </select>
          ) : null,
          sep('r1'),
          b('小節を挿入', { type: 'insert-measure' }, { title: '選んだ小節の前に1小節' }),
          b('小節を削除', { type: 'delete-measures' }),
          <select
            key="time"
            aria-label="拍子"
            value=""
            onChange={(e) => {
              const [beats, beatType] = e.target.value.split('/').map(Number);
              onAction({ type: 'time', beats, beatType });
            }}
          >
            <option value="" disabled>
              拍子
            </option>
            {TIMES.map(([n, d]) => (
              <option key={`${n}/${d}`} value={`${n}/${d}`}>
                {n}/{d}
              </option>
            ))}
          </select>,
          <select
            key="key"
            aria-label="調号"
            value=""
            onChange={(e) => onAction({ type: 'key', fifths: Number(e.target.value) })}
          >
            <option value="" disabled>
              調号
            </option>
            {Array.from({ length: 15 }, (_, i) => i - 7).map((f) => (
              <option key={f} value={f}>
                {keyName({ fifths: f, mode: 'major' })}
              </option>
            ))}
          </select>,
          sep('r2'),
          b('範囲', { type: 'range' }, { on: rangeMode }),
          b('×', { type: 'deselect' }),
        ];

  return (
    <div className="editbar" role="toolbar" aria-label="編集">
      {items}
    </div>
  );
}
