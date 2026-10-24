// 保存データの版番号（schemaVersion）の管理。形を変えたときは、古い版を新しい版へ変換する関数をここに足す。

import { SCHEMA_VERSION, type Project, type Score } from './types';

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] は版 n → n+1 への変換。版1が最初なので、今は空 */
const MIGRATIONS: Record<number, Migration> = {};

export class SchemaError extends Error {}

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new SchemaError('プロジェクトのデータではありません。');
  let data = raw as Record<string, unknown>;
  if (typeof data.schemaVersion !== 'number') throw new SchemaError('版番号（schemaVersion）がありません。');
  let version: number = data.schemaVersion;
  if (version > SCHEMA_VERSION) {
    throw new SchemaError(`新しい版（${version}）のデータです。アプリを更新してから開いてください。`);
  }
  while (version < SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) throw new SchemaError(`版 ${version} から変換できません。`);
    data = m(data);
    version = data.schemaVersion as number;
  }
  return data as unknown as Project;
}

export function newProject(score: Score, deviceId: string, name = score.title || '無題'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    revision: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: deviceId,
    sourceScore: score,
    derivedScores: [],
    arrangements: [],
    settings: {},
  };
}
