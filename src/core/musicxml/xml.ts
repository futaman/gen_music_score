// XMLの読み書き。解析は txml（Web Worker でも動き、速い）を使い、ここだけに閉じ込める。

import { parse as txmlParse } from 'txml/txml'; // 'txml' 本体は node:stream を読み込むので、ブラウザ用の入口を使う
import type { XmlNode } from '../model/types';

type TNode = { tagName: string; attributes: Record<string, string | null>; children: (TNode | string)[] };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function convert(n: TNode): XmlNode {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(n.attributes ?? {})) attrs[k] = v === null ? '' : decodeEntities(v);
  return {
    tag: n.tagName,
    attrs,
    children: n.children.map((c) => (typeof c === 'string' ? decodeEntities(c) : convert(c))),
  };
}

export class XmlParseError extends Error {}

/** XML文字列を解析し、ルート要素を返す（<?xml?> や <!DOCTYPE> は読み飛ばす） */
export function parseXml(xml: string): XmlNode {
  let nodes: (TNode | string)[];
  try {
    // 既定では要素間の空白だけの文字列は捨てられる
    nodes = txmlParse(xml, { keepComments: false }) as (TNode | string)[];
  } catch (e) {
    throw new XmlParseError(String(e));
  }
  const root = nodes.find(
    (n): n is TNode => typeof n !== 'string' && !n.tagName.startsWith('?') && !n.tagName.startsWith('!'),
  );
  if (!root) throw new XmlParseError('ルート要素がありません');
  return convert(root);
}

// ---- 読み取り用の小さな道具 ----

export const elements = (n: XmlNode | undefined): XmlNode[] =>
  n ? (n.children.filter((c) => typeof c !== 'string') as XmlNode[]) : [];
export const child = (n: XmlNode | undefined, tag: string): XmlNode | undefined =>
  n?.children.find((c): c is XmlNode => typeof c !== 'string' && c.tag === tag);
export const childrenOf = (n: XmlNode | undefined, tag: string): XmlNode[] => elements(n).filter((c) => c.tag === tag);
export const text = (n: XmlNode | undefined): string =>
  n ? n.children.map((c) => (typeof c === 'string' ? c : text(c))).join('') : '';
export const childText = (n: XmlNode | undefined, tag: string): string | undefined => {
  const c = child(n, tag);
  return c ? text(c).trim() : undefined;
};
export const childNumber = (n: XmlNode | undefined, tag: string): number | undefined => {
  const t = childText(n, tag);
  if (t === undefined || t === '') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
};

// ---- 書き出し ----

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function attrsToString(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('');
}

/** 要素を書く。children が文字列ならテキスト（エスケープする）、配列ならそのまま連結 */
export function el(
  tag: string,
  attrs: Record<string, string | number | undefined> = {},
  children?: string | string[] | number,
): string {
  const a = attrsToString(attrs);
  if (children === undefined || (Array.isArray(children) && children.length === 0)) return `<${tag}${a}/>`;
  const body = Array.isArray(children) ? children.join('') : escapeXml(String(children));
  return `<${tag}${a}>${body}</${tag}>`;
}

/** 保持しておいた XmlNode をそのまま書き戻す */
export function serializeNode(n: XmlNode): string {
  const body = n.children.map((c) => (typeof c === 'string' ? escapeXml(c) : serializeNode(c)));
  return el(n.tag, n.attrs, body.length ? body : undefined);
}

/**
 * 改行と字下げを入れて読みやすくする。
 * 要素のあいだに空白がないと読み落とす楽譜ソフトがある（MuseScore 3.2 は <ornaments> の中身が詰まっていると以降のパートを失う）。
 * 文字だけを含む要素（<step>C</step> など）は1行のままにする。
 */
export function prettyXml(xml: string, indent = '  '): string {
  const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? [];
  const out: string[] = [];
  let depth = 0;
  const isOpen = (t: string) => t[0] === '<' && t[1] !== '/' && t[1] !== '?' && t[1] !== '!' && !t.endsWith('/>');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t[0] !== '<') {
      if (t.trim()) out.push(indent.repeat(depth) + t);
      continue;
    }
    if (isOpen(t) && tokens[i + 1]?.[0] !== '<' && tokens[i + 2]?.startsWith('</')) {
      out.push(indent.repeat(depth) + t + tokens[i + 1] + tokens[i + 2]);
      i += 2;
    } else if (isOpen(t) && tokens[i + 1]?.startsWith('</')) {
      out.push(indent.repeat(depth) + t + tokens[i + 1]);
      i += 1;
    } else if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push(indent.repeat(depth) + t);
    } else {
      out.push(indent.repeat(depth) + t);
      if (isOpen(t)) depth++;
    }
  }
  return out.join('\n') + '\n';
}
