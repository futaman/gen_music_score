import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { projectFileName, projectToJson } from '../core/model/projectFile';
import { createArrangement, ensembleName } from '../core/arrange/workspace';
import type { Arrangement, Project, Score } from '../core/model/types';
import { AutoSaver, saveStateLabel } from '../storage/autosave';
import { deviceId, markClosed, markOpen, scoreById } from '../storage/projects';
import { ScoreScreen } from './ScoreScreen';

type Props = { project: Project; onBack: () => void };

/** プロジェクトを開いている画面。編集を端末へ自動保存する */
export function ProjectScreen({ project, onBack }: Props) {
  const [saver] = useState(() => new AutoSaver(project, deviceId()));
  useSyncExternalStore(saver.subscribe, saver.getVersion);

  useEffect(() => {
    markOpen(project.id);
    const hide = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const leave = () => void saver.flush();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      void saver.flush();
    };
  }, [project.id, saver]);

  const onScoreChange = useCallback((s: Score) => saver.schedule(s), [saver]);

  // 開いている楽譜（元の楽譜か、編曲で作った楽譜）
  const [currentId, setCurrentId] = useState(project.sourceScore.id);
  const latest = saver.current();
  const score = scoreById(latest, currentId) ?? latest.sourceScore;
  const arrangement = latest.arrangements.find((a) => a.targetScoreId === score.id);
  const scores = [
    { id: latest.sourceScore.id, label: '元の楽譜' },
    ...latest.arrangements.map((a) => ({ id: a.targetScoreId, label: `編曲：${ensembleName(a)}` })),
  ];

  const createArr = (ensembleId: string, rotateMelody: boolean) => {
    const p = saver.current();
    const made = createArrangement(p.sourceScore, ensembleId, { rotateMelody });
    saver.update({
      ...p,
      derivedScores: [...p.derivedScores, made.score],
      arrangements: [...p.arrangements, made.arrangement],
    });
    setCurrentId(made.score.id);
  };
  const changeArr = (a: Arrangement) => {
    const p = saver.current();
    saver.update({ ...p, arrangements: p.arrangements.map((x) => (x.id === a.id ? a : x)) });
  };
  const deleteArr = (a: Arrangement) => {
    const p = saver.current();
    saver.update({
      ...p,
      arrangements: p.arrangements.filter((x) => x.id !== a.id),
      derivedScores: p.derivedScores.filter((x) => x.id !== a.targetScoreId),
    });
    setCurrentId(p.sourceScore.id);
  };

  const saveToFile = () => {
    const p = saver.current();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([projectToJson(p)], { type: 'application/json' }));
    a.download = projectFileName(p);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <ScoreScreen
      key={score.id}
      score={score}
      name={arrangement ? `${project.name}（${ensembleName(arrangement)}）` : project.name}
      scores={scores}
      onSelectScore={setCurrentId}
      onCreateArrangement={arrangement ? undefined : createArr}
      arrange={
        arrangement
          ? {
              source: latest.sourceScore,
              arrangement,
              onChange: changeArr,
              onDelete: () => deleteArr(arrangement),
            }
          : undefined
      }
      onScoreChange={onScoreChange}
      saveStatus={saveStateLabel(saver)}
      onSaveProject={saveToFile}
      onBack={async () => {
        await saver.flush();
        markClosed();
        onBack();
      }}
    />
  );
}
