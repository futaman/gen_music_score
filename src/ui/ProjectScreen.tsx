import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { projectFileName, projectToJson } from '../core/model/projectFile';
import type { Project, Score } from '../core/model/types';
import { AutoSaver, saveStateLabel } from '../storage/autosave';
import { deviceId, markClosed, markOpen } from '../storage/projects';
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
      score={project.sourceScore}
      name={project.name}
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
