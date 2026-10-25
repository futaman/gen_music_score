// 編集中の楽譜と、元に戻す／やり直しの履歴。

import { useCallback, useState } from 'react';
import { fillMeasures, type EditResult } from '../core/edit/commands';
import { History } from '../core/edit/history';
import type { Score } from '../core/model/types';
import type { EditMark } from './ScoreView';

/** extra：楽譜と一緒に元に戻したい状態（編曲の割当表など） */
type State<T> = { score: Score; extra: T } & EditMark;

export function useEditor<T = undefined>(initial: Score, initialExtra?: T) {
  const [state, setState] = useState<State<T | undefined>>({
    score: initial,
    extra: initialExtra,
    revision: 0,
    changed: 'all',
  });
  const [history] = useState(() => new History(100));

  /**
   * 編集の結果を反映する。変わらなかったときは説明（message）を返す。
   * extra を渡すと、楽譜と一緒に変える（楽譜が変わらなくても記録する）
   */
  // 履歴への記録は setState の外で行う（開発時の StrictMode は setState の関数を2回呼ぶため）
  const apply = useCallback(
    (r: EditResult, label: string, extra?: T): string | undefined => {
      const noChange = r.changed !== 'all' && r.changed.length === 0;
      if (noChange && extra === undefined) return r.message ?? '変わりませんでした';
      history.push({ score: state.score, changed: r.changed, label, extra: state.extra });
      // 拍が足りなくなった小節は休符で埋める
      const score = r.changed === 'all' ? r.score : noChange ? r.score : fillMeasures(r.score, r.changed);
      setState({
        score,
        extra: extra === undefined ? state.extra : extra,
        revision: state.revision + 1,
        changed: r.changed,
      });
      return r.message;
    },
    [history, state],
  );

  const undo = useCallback(() => {
    const e = history.undo(state.score, state.extra);
    if (e)
      setState({ score: e.score, extra: e.extra as T | undefined, revision: state.revision + 1, changed: e.changed });
  }, [history, state]);

  const redo = useCallback(() => {
    const e = history.redo(state.score, state.extra);
    if (e)
      setState({ score: e.score, extra: e.extra as T | undefined, revision: state.revision + 1, changed: e.changed });
  }, [history, state]);

  return {
    score: state.score,
    extra: state.extra,
    edit: { revision: state.revision, changed: state.changed } satisfies EditMark,
    apply,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  };
}
