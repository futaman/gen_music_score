import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readScoreFile } from '../musicxml/file';
import { looksLikeProject, parseProjectJson, projectFileName, projectToJson } from './projectFile';
import { newProject, SchemaError } from './schema';

const bytes = new Uint8Array(readFileSync(new URL('../../../test-assets/musicxml/mozart-k387.mxl', import.meta.url)));

describe('プロジェクトJSON', () => {
  it('書き出して読み戻すと同じ', () => {
    const p = newProject(readScoreFile(bytes, 'k387.mxl').score, 'dev1', 'K.387 / 練習');
    const text = projectToJson(p);
    expect(parseProjectJson(text)).toEqual(p);
    expect(projectFileName(p)).toBe('K.387 _ 練習.gakufu.json');
    expect(looksLikeProject('x.gakufu.json', new TextEncoder().encode(text))).toBe(true);
  });
  it('MusicXML とは見分け、壊れたファイルは断る', () => {
    expect(looksLikeProject('k387.mxl', bytes)).toBe(false);
    expect(looksLikeProject('a.xml', new TextEncoder().encode('<?xml version="1.0"?>'))).toBe(false);
    expect(() => parseProjectJson('<score/>')).toThrow(SchemaError);
    expect(() => parseProjectJson('{"schemaVersion":1,"id":"x"}')).toThrow(/壊れています/);
  });
});
