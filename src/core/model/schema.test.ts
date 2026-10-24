import { describe, expect, it } from 'vitest';
import { migrateProject, newProject, SchemaError } from './schema';
import type { Score } from './types';

const score: Score = {
  schemaVersion: 1,
  id: 's',
  title: 'T',
  composer: '',
  parts: [],
  measures: [],
  notes: [],
  directions: [],
  clefs: [],
};

describe('保存データの版番号', () => {
  it('現在の版はそのまま読める（JSONを通しても同じ）', () => {
    const p = newProject(score, 'dev1');
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('版番号がない・新しすぎるデータは断る', () => {
    expect(() => migrateProject({})).toThrow(SchemaError);
    expect(() => migrateProject({ schemaVersion: 99 })).toThrow(/新しい版/);
  });
});
