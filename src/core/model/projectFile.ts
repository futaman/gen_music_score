// プロジェクトJSON の「ファイルに保存／ファイルから開く」

import { migrateProject, SchemaError } from './schema';
import type { Project } from './types';

export const PROJECT_EXT = '.gakufu.json';

export function projectToJson(p: Project): string {
  return JSON.stringify(p);
}

export function projectFileName(p: Project): string {
  const base = (p.name || '無題').replace(/[\\/:*?"<>|]/g, '_').trim() || '無題';
  return base + PROJECT_EXT;
}

/** 読み込んで、今の版に変換する。形がおかしいときは SchemaError */
export function parseProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SchemaError('プロジェクトのファイルとして読めません（JSONではありません）。');
  }
  const p = migrateProject(raw);
  const s = p.sourceScore as unknown as Record<string, unknown> | undefined;
  if (
    typeof p.id !== 'string' ||
    !s ||
    !Array.isArray(s.parts) ||
    !Array.isArray(s.measures) ||
    !Array.isArray(s.notes)
  ) {
    throw new SchemaError('プロジェクトのファイルではないか、壊れています。');
  }
  return {
    ...p,
    name: typeof p.name === 'string' ? p.name : '無題',
    revision: typeof p.revision === 'number' ? p.revision : 1,
    derivedScores: p.derivedScores ?? [],
    arrangements: p.arrangements ?? [],
    settings: p.settings ?? {},
  };
}

/** ファイルの中身がプロジェクトJSON らしいか（MusicXML と見分ける） */
export function looksLikeProject(fileName: string, bytes: Uint8Array): boolean {
  if (/\.json$/i.test(fileName)) return true;
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0xef) i += 3; // BOM
  return bytes[i] === 0x7b; // {
}
