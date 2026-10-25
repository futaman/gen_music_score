import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { newProject } from '../core/model/schema';
import { readScoreFile } from '../core/musicxml/file';
import { deleteProject, listProjects, loadProject, putProject, renameProject, saveScore } from './projects';

const asset = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test-assets/musicxml/${name}`, import.meta.url)));
const score = readScoreFile(asset('mozart-k387.mxl'), 'k387.mxl').score;

describe('端末内保存', () => {
  beforeEach(async () => {
    for (const p of await listProjects()) await deleteProject(p.id);
  });

  it('保存して読み戻すと同じ楽譜。一覧は新しい順', async () => {
    const a = newProject(score, 'dev1', 'A');
    await putProject(a);
    const b = { ...newProject(score, 'dev1', 'B'), updatedAt: new Date(Date.now() + 1000).toISOString() };
    await putProject(b);
    expect((await listProjects()).map((p) => p.name)).toEqual(['B', 'A']);
    expect(await loadProject(a.id)).toEqual(a);
    expect((await listProjects())[0]).toMatchObject({ parts: 4, measures: score.measures.length });
  });

  it('保存ごとに revision が増え、名前の変更・削除ができる', async () => {
    const a = newProject(score, 'dev1', 'A');
    await putProject(a);
    const edited = { ...score, title: '変えた' };
    const a2 = await saveScore(a, edited, 'dev2');
    expect(a2.revision).toBe(a.revision + 1);
    expect((await loadProject(a.id))?.sourceScore.title).toBe('変えた');
    expect((await loadProject(a.id))?.updatedBy).toBe('dev2');
    await renameProject(a.id, '新しい名前');
    expect((await listProjects())[0]).toMatchObject({ name: '新しい名前', revision: a2.revision + 1 });
    await deleteProject(a.id);
    expect(await listProjects()).toEqual([]);
    expect(await loadProject(a.id)).toBeUndefined();
  });
});
