import { useCallback, useEffect, useState } from 'react';
import { looksLikeProject, parseProjectJson, PROJECT_EXT } from '../core/model/projectFile';
import { newProject } from '../core/model/schema';
import type { Project } from '../core/model/types';
import type { ImportResult } from '../core/musicxml/file';
import {
  deleteProject,
  deviceId,
  listProjects,
  loadProject,
  markClosed,
  putProject,
  renameProject,
  requestPersist,
  uncleanProject,
  type ProjectSummary,
} from '../storage/projects';
import { About } from './About';
import { ImportSummary } from './ImportSummary';
import { importInWorker } from './importScore';
import { ProjectScreen } from './ProjectScreen';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; fileName: string }
  | { kind: 'loaded'; fileName: string; result: ImportResult; ms: number }
  | { kind: 'error'; fileName: string; message: string };

const storageMessage = (e: unknown) =>
  `端末に保存できません（${e instanceof Error ? e.message : String(e)}）。ファイルに保存してください。`;

const baseName = (fileName: string) => fileName.replace(/\.(mxl|musicxml|xml)$/i, '');

/** スマホ・タブレットのブラウザで、ホーム画面に追加していない */
const isBrowserTab = () =>
  !window.matchMedia?.('(display-mode: standalone)').matches &&
  !(navigator as Navigator & { standalone?: boolean }).standalone;

export function App() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<Project | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [restore, setRestore] = useState<ProjectSummary | null>(null);
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined);

  const loadList = useCallback(
    () =>
      listProjects().catch((e: unknown) => {
        setStorageError(storageMessage(e));
        return [] as ProjectSummary[];
      }),
    [],
  );
  const refresh = async () => setProjects(await loadList());

  // 起動時：一覧を読み、前回きちんと閉じなかったプロジェクトがあれば復元を尋ねる
  useEffect(() => {
    let alive = true;
    void loadList().then((list) => {
      if (!alive) return;
      setProjects(list);
      const id = uncleanProject();
      const p = id ? list.find((x) => x.id === id) : undefined;
      if (p) setRestore(p);
      else if (id) markClosed();
    });
    void navigator.storage?.persisted?.().then((v) => alive && setPersisted(v));
    return () => {
      alive = false;
    };
  }, [loadList]);

  async function openProject(id: string) {
    setRestore(null);
    try {
      const p = await loadProject(id);
      if (p) setOpen(p);
      else setState({ kind: 'error', fileName: '', message: 'プロジェクトが見つかりません。' });
    } catch (e) {
      setState({ kind: 'error', fileName: '', message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 新しいプロジェクトを端末に保存して開く（保存できなくても開く） */
  async function start(p: Project) {
    try {
      await putProject(p);
      setPersisted(await requestPersist());
    } catch (e) {
      setStorageError(
        `端末に保存できません（${e instanceof Error ? e.message : String(e)}）。ファイルに保存してください。`,
      );
    }
    setState({ kind: 'idle' });
    setOpen(p);
  }

  async function openFile(file: File) {
    setState({ kind: 'loading', fileName: file.name });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksLikeProject(file.name, bytes)) {
      try {
        let p = parseProjectJson(new TextDecoder().decode(bytes));
        // 同じプロジェクトが端末にあれば上書きせず、別のプロジェクトとして開く
        if ((projects ?? []).some((x) => x.id === p.id)) {
          p = { ...p, id: crypto.randomUUID(), name: `${p.name}（ファイルから）` };
        }
        await start(p);
      } catch (e) {
        setState({ kind: 'error', fileName: file.name, message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    const res = await importInWorker(bytes, file.name);
    setState(
      res.ok
        ? { kind: 'loaded', fileName: file.name, result: res.result, ms: res.ms }
        : { kind: 'error', fileName: file.name, message: res.message },
    );
  }

  if (open) {
    return (
      <ProjectScreen
        key={open.id}
        project={open}
        onBack={() => {
          setOpen(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="app">
      <h1>楽譜アプリ</h1>
      {restore && (
        <div className="notice warn" role="alert">
          <p>前回「{restore.name}」を開いたまま終了しました。続きを開きますか？（編集は端末に自動保存されています）</p>
          <div className="actions">
            <button className="button primary" onClick={() => void openProject(restore.id)}>
              続きを開く
            </button>
            <button
              className="button"
              onClick={() => {
                markClosed();
                setRestore(null);
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
      <label
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void openFile(f);
        }}
      >
        <span>
          MusicXMLファイル（.musicxml / .xml / .mxl）かプロジェクトのファイル（{PROJECT_EXT}）を選ぶか、ここにドロップ
        </span>
        <span className="button primary">ファイルを選ぶ</span>
        <input
          type="file"
          accept=".musicxml,.xml,.mxl,.json,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,application/json"
          aria-label="楽譜ファイル"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
      </label>

      {state.kind === 'loading' && <p className="muted">{state.fileName} を読み込み中…</p>}
      {state.kind === 'error' && (
        <div className="notice error" role="alert">
          {state.fileName && `${state.fileName}：`}
          {state.message}
        </div>
      )}
      {storageError && <div className="notice error">{storageError}</div>}
      {state.kind === 'loaded' && (
        <ImportSummary
          fileName={state.fileName}
          result={state.result}
          ms={state.ms}
          onOpen={() => {
            const score = state.result.score;
            void start(newProject(score, deviceId(), score.title || baseName(state.fileName)));
          }}
        />
      )}

      {projects && projects.length > 0 && (
        <section aria-label="プロジェクト">
          <h2>プロジェクト</h2>
          {persisted === false && isBrowserTab() && (
            <p className="notice">
              ブラウザが端末内のデータを消すことがあります（iPhone・iPadのSafariなど）。ホーム画面に追加するか、ときどき「プロジェクトをファイルに保存」してください。
            </p>
          )}
          <ul className="projects">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="open" onClick={() => void openProject(p.id)}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.composer && `${p.composer}・`}
                    {p.parts}パート・{p.measures}小節・{new Date(p.updatedAt).toLocaleString('ja-JP')}
                  </small>
                </button>
                <button
                  className="button"
                  aria-label={`${p.name}の名前を変える`}
                  onClick={async () => {
                    const name = prompt('新しい名前', p.name)?.trim();
                    if (!name || name === p.name) return;
                    await renameProject(p.id, name);
                    await refresh();
                  }}
                >
                  名前
                </button>
                <button
                  className="button"
                  aria-label={`${p.name}を削除`}
                  onClick={async () => {
                    if (!confirm(`「${p.name}」を削除しますか？元に戻せません。`)) return;
                    await deleteProject(p.id);
                    await refresh();
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <About />
    </div>
  );
}
