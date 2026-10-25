// 端末内（IndexedDB）へのプロジェクト保存。仕様：docs/spec.md「保存とログイン」
// 一覧を速く出すため、プロジェクト本体（projects）と一覧用の要約（summaries）を分けて持つ。

import { migrateProject } from '../core/model/schema';
import type { Project, Score } from '../core/model/types';

const DB_NAME = 'gen-music-score';
const DB_VERSION = 1;

export type ProjectSummary = {
  id: string;
  name: string;
  title: string;
  composer: string;
  parts: number;
  measures: number;
  revision: number;
  updatedAt: string;
};

export function summarize(p: Project): ProjectSummary {
  const s = p.sourceScore;
  return {
    id: p.id,
    name: p.name,
    title: s.title,
    composer: s.composer,
    parts: s.parts.length,
    measures: s.measures.length,
    revision: p.revision,
    updatedAt: p.updatedAt,
  };
}

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('summaries')) d.createObjectStore('summaries', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // 別のタブで版を上げたら閉じて、次の操作で開き直す
      req.result.onversionchange = () => {
        req.result.close();
        opening = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('端末内の保存場所を開けませんでした。'));
    };
  });
  return opening;
}

/** テスト用：開いている接続を閉じる */
export async function closeDb() {
  if (!opening) return;
  (await opening).close();
  opening = null;
}

function run<T>(mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(['projects', 'summaries'], mode);
        const req = fn(tx);
        tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
        tx.onerror = () => reject(tx.error ?? new Error('保存できませんでした。'));
        tx.onabort = () => reject(tx.error ?? new Error('保存できませんでした（容量が足りない可能性があります）。'));
      }),
  );
}

/** 一覧（新しく更新した順） */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await run<ProjectSummary[]>('readonly', (tx) => tx.objectStore('summaries').getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await run<unknown>('readonly', (tx) => tx.objectStore('projects').get(id));
  return raw === undefined ? undefined : migrateProject(raw);
}

/** そのまま書き込む（revision などは変えない） */
export async function putProject(p: Project): Promise<void> {
  await run('readwrite', (tx) => {
    tx.objectStore('projects').put(p);
    tx.objectStore('summaries').put(summarize(p));
  });
}

/** 楽譜を差し替えて保存する。保存ごとに revision を1つ増やす */
export async function saveScore(p: Project, score: Score, deviceId: string): Promise<Project> {
  const next: Project = {
    ...p,
    sourceScore: score,
    revision: p.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: deviceId,
  };
  await putProject(next);
  return next;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const p = await loadProject(id);
  if (!p) return;
  await putProject({ ...p, name, revision: p.revision + 1, updatedAt: new Date().toISOString() });
}

export async function deleteProject(id: string): Promise<void> {
  await run('readwrite', (tx) => {
    tx.objectStore('projects').delete(id);
    tx.objectStore('summaries').delete(id);
  });
}

/** 端末ごとの ID（どの端末で保存したかの記録用） */
export function deviceId(): string {
  const KEY = 'gms.deviceId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

/**
 * ブラウザに「データを消さないで」と頼む（iPhone/iPad の Safari 対策）。
 * 結果：true＝消されにくい、false＝消されることがある、undefined＝確かめられない
 */
export async function requestPersist(): Promise<boolean | undefined> {
  if (!navigator.storage?.persist) return undefined;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}

// ---- 落ちたときの復元 ----
// プロジェクトを開いている間だけ印を付けておく。次に起動したとき印が残っていたら、正しく閉じなかったということ。

const SESSION_KEY = 'gms.openProject';

export function markOpen(id: string) {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // 保存できない環境では復元の案内を出さないだけ
  }
}

export function markClosed() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // 同上
  }
}

export function uncleanProject(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
