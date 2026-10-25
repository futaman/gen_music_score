// 編集中の楽譜と、元に戻す／やり直しの履歴。

import { useCallback, useState } from 'react';
import { fillMeasures, type EditResult } from '../core/edit/commands';
import { History } from '../core/edit/history';
import type { Score } from '../core/model/types';
import type { EditMark } from './ScoreView';

type State = { score: Score } & EditMark;

export function useEditor(initial: Score) {
  const [state, setState] = useState<State>({ score: initial, revision: 0, changed: 'all' });
  const [history] = useState(() => new History(100));

  /** 編集の結果を反映する。変わらなかったときは説明（message）を返す */
  // 履歴への記録は setState の外で行う（開発時の StrictMode は setState の関数を2回呼ぶため）
  const apply = useCallback(
    (r: EditResult, label: string): string | undefined => {
      if (r.changed !== 'all' && r.changed.length === 0) return r.message ?? '変わりませんでした';
      history.push({ score: state.score, changed: r.changed, label });
      // 拍が足りなくなった小節は休符で埋める
      const score = r.changed === 'all' ? r.score : fillMeasures(r.score, r.changed);
      setState({ score, revision: state.revision + 1, changed: r.changed });
      return r.message;
    },
    [history, state],
  );

  const undo = useCallback(() => {
    const e = history.undo(state.score);
    if (e) setState({ score: e.score, revision: state.revision + 1, changed: e.changed });
  }, [history, state]);

  const redo = useCallback(() => {
    const e = history.redo(state.score);
    if (e) setState({ score: e.score, revision: state.revision + 1, changed: e.changed });
  }, [history, state]);

  return {
    score: state.score,
    edit: { revision: state.revision, changed: state.changed } satisfies EditMark,
    apply,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  };
}
