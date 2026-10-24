// MusicXML（score-partwise）を小節範囲ごとの小さなMusicXMLに分ける。
// 各チャンクの先頭小節には、その時点で有効な attributes（divisions・調号・拍子・音部記号・移調）を補う。
// 本番では内部データから直接チャンクを書き出すので、これは試作専用。

export type Chunk = { start: number; end: number; xml: string }; // start/end: 小節index（0始まり、endは含まない）

type DomParserLike = { parseFromString(s: string, type: string): Document };
type SerializerLike = { serializeToString(n: Node): string };

const CARRY = ['divisions', 'key', 'time', 'staves', 'clef', 'transpose'];
const keyOf = (c: Element) => (c.tagName === 'clef' ? `clef${c.getAttribute('number') ?? '1'}` : c.tagName);
const elements = (n: Node) => Array.from(n.childNodes).filter((c) => (c as Element).tagName) as Element[];

export function splitMusicXml(xml: string, size: number, parser: DomParserLike, serializer: SerializerLike): Chunk[] {
  const doc = parser.parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const head = elements(root).filter((e) => e.tagName !== 'part').map((e) => serializer.serializeToString(e)).join('');
  const parts = elements(root).filter((e) => e.tagName === 'part');

  // パートごとに、各小節の文字列と「その小節の頭で補うべき attributes」を作る
  const perPart = parts.map((p) => {
    const state = new Map<string, string>();
    return elements(p).filter((m) => m.tagName === 'measure').map((m) => {
      const carried = new Map(state);
      const attrs = elements(m).find((e) => e.tagName === 'attributes');
      if (attrs) for (const c of elements(attrs)) if (CARRY.includes(c.tagName)) state.set(keyOf(c), serializer.serializeToString(c));
      const own = attrs ? new Set(elements(attrs).map(keyOf)) : new Set<string>();
      const missing = [...carried.entries()].filter(([k]) => !own.has(k));
      return { m, missing, attrs };
    });
  });
  const total = Math.min(...perPart.map((ms) => ms.length));

  const measureXml = (pi: number, mi: number, first: boolean) => {
    const { m, missing, attrs } = perPart[pi][mi];
    if (!first || missing.length === 0) return serializer.serializeToString(m);
    const order = (k: string) => CARRY.indexOf(k.replace(/^clef\d+$/, 'clef'));
    const ownList = attrs ? elements(attrs).map((c) => [keyOf(c), serializer.serializeToString(c)] as [string, string]) : [];
    const merged = [...ownList, ...missing].sort((a, b) => order(a[0]) - order(b[0])).map(([, s]) => s).join('');
    const rest = elements(m).filter((e) => e !== attrs).map((e) => serializer.serializeToString(e)).join('');
    const open = serializer.serializeToString(m.cloneNode(false)).replace(/\/>$/, '>').replace(/<\/measure>$/, '');
    return `${open}<attributes>${merged}</attributes>${rest}</measure>`;
  };

  const chunks: Chunk[] = [];
  for (let start = 0; start < total; start += size) {
    const end = Math.min(total, start + size);
    let body = '';
    parts.forEach((p, pi) => {
      body += `<part id="${p.getAttribute('id')}">`;
      for (let mi = start; mi < end; mi++) body += measureXml(pi, mi, mi === start);
      body += '</part>';
    });
    chunks.push({ start, end, xml: `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${head}${body}</score-partwise>` });
  }
  return chunks;
}
