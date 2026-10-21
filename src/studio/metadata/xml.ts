/**
 * Metadata API XML as a small tree, read and written in the format `sf project
 * retrieve` produces: four-space indents, one element per line, leaf text
 * inline, empty elements self-closed. A retrieved file written back unchanged is
 * byte-identical, so a review diff shows only what an edit changed.
 *
 * Text is kept escaped as it was in the file (`&apos;` stays `&apos;`); `childText()`
 * unescapes it and `leaf()` escapes new values.
 */

import { XMLParser } from "fast-xml-parser";

export interface XmlNode {
  tag: string;
  attrs?: Record<string, string>;
  /** Escaped text of a leaf element. */
  text?: string;
  children: XmlNode[];
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
});

type Parsed = Record<string, unknown> & { ":@"?: Record<string, string> };

function fromParsed(p: Parsed): XmlNode | null {
  const tag = Object.keys(p).find((k) => k !== ":@");
  if (!tag || tag === "#text") return null;
  const raw = (p[tag] as Parsed[]) ?? [];
  const node: XmlNode = { tag, children: [] };
  if (p[":@"]) node.attrs = { ...p[":@"] };
  if (raw.length === 1 && "#text" in raw[0]) node.text = String(raw[0]["#text"]);
  else node.children = raw.map(fromParsed).filter((n): n is XmlNode => !!n);
  return node;
}

/** The document's root element. */
export function parseXml(xml: string): XmlNode {
  const roots = (parser.parse(xml) as Parsed[]).map(fromParsed).filter((n): n is XmlNode => !!n);
  if (roots.length !== 1) throw new Error("Expected one root element in the metadata file.");
  return roots[0];
}

function write(node: XmlNode, depth: number): string {
  const pad = "    ".repeat(depth);
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("")
    : "";
  if (node.text !== undefined && node.children.length === 0)
    return `${pad}<${node.tag}${attrs}>${node.text}</${node.tag}>\n`;
  if (node.children.length === 0) return `${pad}<${node.tag}${attrs}/>\n`;
  return `${pad}<${node.tag}${attrs}>\n${node.children.map((c) => write(c, depth + 1)).join("")}${pad}</${node.tag}>\n`;
}

export function serializeXml(root: XmlNode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${write(root, 0)}`;
}

/** One element on its own, without the declaration — what an undo keeps of something removed. */
export const serializeNode = (node: XmlNode): string => write(node, 0);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPES).map(([k, v]) => [v, k])
);

export const escapeXml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const unescapeXml = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(
          e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        )
      : UNESCAPES[m]
  );

/** A leaf element holding `value` (escaped). */
export const leaf = (tag: string, value: string): XmlNode => ({
  tag,
  text: escapeXml(value),
  children: [],
});

/** Direct children named `tag`. */
export const childrenNamed = (node: XmlNode, tag: string): XmlNode[] =>
  node.children.filter((c) => c.tag === tag);

/** The unescaped text of the first child named `tag`, or undefined. */
export function childText(node: XmlNode, tag: string): string | undefined {
  const c = node.children.find((x) => x.tag === tag);
  return c?.text === undefined ? (c ? "" : undefined) : unescapeXml(c.text);
}

/** Set (or add, keeping the children in schema order) the leaf child `tag`. */
export function setChildText(
  node: XmlNode,
  tag: string,
  value: string,
  order: readonly string[]
): void {
  const existing = node.children.find((x) => x.tag === tag);
  if (existing) {
    existing.text = escapeXml(value);
    existing.children = [];
    return;
  }
  insertInOrder(node, leaf(tag, value), order);
}

/**
 * Insert `child` among `node`'s children where the schema's element order puts
 * it: after the last sibling of the same tag, else before the first sibling
 * whose tag comes later in `order`, else at the end. The Metadata API reads
 * elements in schema order.
 */
export function insertInOrder(node: XmlNode, child: XmlNode, order: readonly string[]): void {
  let last = -1;
  node.children.forEach((c, i) => {
    if (c.tag === child.tag) last = i;
  });
  if (last >= 0) {
    node.children.splice(last + 1, 0, child);
    return;
  }
  const rank = order.indexOf(child.tag);
  const later = rank < 0 ? -1 : node.children.findIndex((c) => order.indexOf(c.tag) > rank);
  if (later >= 0) node.children.splice(later, 0, child);
  else node.children.push(child);
}

export const cloneNode = (node: XmlNode): XmlNode => JSON.parse(JSON.stringify(node)) as XmlNode;
