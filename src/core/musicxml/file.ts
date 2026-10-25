// ファイル（.musicxml / .xml / .mxl）のバイト列を MusicXML の文字列にする。

import { strFromU8, unzipSync } from 'fflate';
import { ImportError, MAX_FILE_BYTES } from './errors';
import { isMidi } from '../midi/parse';
import { importMidi } from '../midi/toScore';
import { importMusicXml, type ImportResult } from './import';

export type { ImportResult };

export function decodeScoreFile(bytes: Uint8Array, fileName = ''): string {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ImportError(
      'too-large',
      `ファイルが大きすぎます（${(bytes.length / 1024 / 1024).toFixed(1)}MB）。20MBまでのファイルを読み込めます。`,
    );
  }
  const head = String.fromCharCode(...bytes.subarray(0, 8));
  if (head.startsWith('PK')) return decodeZip(bytes, fileName);
  if (head.startsWith('%PDF'))
    throw new ImportError(
      'unsupported-format',
      'PDFの読み込みにはまだ対応していません。楽譜ソフトでMusicXMLに書き出してから読み込んでください。',
    );
  const text = decodeText(bytes);
  if (!/<score-(partwise|timewise)[\s>]/.test(text.slice(0, 20000))) {
    throw new ImportError(
      'unsupported-format',
      'MusicXMLファイルではないようです（.musicxml / .xml / .mxl を選んでください）。',
    );
  }
  return text;
}

function decodeText(bytes: Uint8Array): string {
  // UTF-16 で書き出すソフトもある
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeZip(bytes: Uint8Array, fileName: string): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ImportError('broken', '圧縮ファイル（.mxl）を展開できません。ファイルが壊れている可能性があります。');
  }
  const container = files['META-INF/container.xml'];
  let rootPath: string | undefined;
  if (container) {
    const xml = strFromU8(container);
    const rootfiles = [...xml.matchAll(/<rootfile\b[^>]*>/g)].map((m) => m[0]);
    const pick =
      rootfiles.find((r) => !/media-type="(?!application\/vnd\.recordare\.musicxml)/.test(r)) ?? rootfiles[0];
    rootPath = pick?.match(/full-path="([^"]+)"/)?.[1];
  }
  rootPath ??= Object.keys(files).find((f) => !f.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(f));
  if ((rootPath && /\.mscx$/i.test(rootPath)) || /\.mscz$/i.test(fileName)) {
    throw new ImportError(
      'musescore-file',
      'MuseScoreの保存ファイル（.mscz）は読み込めません。MuseScoreで「書き出し → MusicXML」をしてから読み込んでください。',
    );
  }
  if (!rootPath || !files[rootPath]) throw new ImportError('broken', '.mxl の中に楽譜ファイルが見つかりません。');
  return decodeText(files[rootPath]);
}

/** 楽譜ファイル（MusicXML・.mxl・MIDI）を読む */
export function readScoreFile(bytes: Uint8Array, fileName = ''): ImportResult {
  if (isMidi(bytes)) return importMidi(bytes, fileName);
  return importMusicXml(decodeScoreFile(bytes, fileName));
}
