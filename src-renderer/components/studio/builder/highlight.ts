/** Light syntax highlighting for the files of an LSC app (JS, HTML, CSS, XML) — no dependencies, lines in, tokens out. */

export interface Token {
  text: string;
  cls?: "kw" | "str" | "com" | "num" | "tag" | "attr" | "fn" | "pun";
}

export type Lang = "js" | "html" | "css" | "xml" | "text";

export const langOf = (path: string): Lang =>
  /\.js$/.test(path) ? "js" : /\.html$/.test(path) ? "html" : /\.css$/.test(path) ? "css" : /\.xml$/.test(path) ? "xml" : "text";

const KEYWORDS = new Set(
  "import export from default const let var function return if else for while do switch case break continue new this class extends super async await try catch finally throw typeof instanceof in of null undefined true false static get set void delete yield".split(" ")
);

/** Split flat tokens into one array per line. */
function byLine(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, cls: t.cls });
    });
  }
  return lines;
}

function js(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) out.push({ text: plain });
    plain = "";
  };
  const push = (text: string, cls: Token["cls"]) => {
    flush();
    out.push({ text, cls });
  };
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = src.length;
      push(src.slice(i, j), "com");
      i = j;
    } else if (two === "/*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? src.length : j + 2;
      push(src.slice(i, j), "com");
      i = j;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      j = Math.min(src.length, j + 1);
      push(src.slice(i, j), "str");
      i = j;
    } else if (/[0-9]/.test(c) && !/[\w$]/.test(src[i - 1] ?? "")) {
      const m = /^(0x[0-9a-f]+|\d[\d_]*\.?\d*(e[+-]?\d+)?)/i.exec(src.slice(i))!;
      push(m[0], "num");
      i += m[0].length;
    } else if (/[A-Za-z_$@]/.test(c)) {
      const m = /^@?[\w$]+/.exec(src.slice(i))!;
      const word = m[0];
      const next = src.slice(i + word.length).match(/^\s*\(/);
      if (KEYWORDS.has(word)) push(word, "kw");
      else if (word.startsWith("@")) push(word, "kw");
      else if (next) push(word, "fn");
      else plain += word;
      i += word.length;
    } else {
      plain += c;
      i++;
    }
  }
  flush();
  return out;
}

function markup(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      let j = src.indexOf("-->", i + 4);
      j = j < 0 ? src.length : j + 3;
      out.push({ text: src.slice(i, j), cls: "com" });
      i = j;
    } else if (src[i] === "<" && /[A-Za-z/!?]/.test(src[i + 1] ?? "")) {
      // A tag: name, attributes, close.
      const m = /^<\/?[\w:.-]*|^<[!?][^>]*/.exec(src.slice(i))!;
      out.push({ text: m[0], cls: "tag" });
      i += m[0].length;
      while (i < src.length && src[i] !== ">") {
        if (/\s/.test(src[i])) {
          const w = /^\s+/.exec(src.slice(i))![0];
          out.push({ text: w });
          i += w.length;
        } else if (src[i] === '"' || src[i] === "'") {
          let j = src.indexOf(src[i], i + 1);
          j = j < 0 ? src.length : j + 1;
          out.push({ text: src.slice(i, j), cls: "str" });
          i = j;
        } else if (src[i] === "{") {
          let j = src.indexOf("}", i);
          j = j < 0 ? src.length : j + 1;
          out.push({ text: src.slice(i, j), cls: "fn" });
          i = j;
        } else if (src[i] === "=" || src[i] === "/") {
          out.push({ text: src[i], cls: "pun" });
          i++;
        } else {
          const w = /^[^\s=/>"'{]+/.exec(src.slice(i))?.[0] ?? src[i];
          out.push({ text: w, cls: "attr" });
          i += w.length;
        }
      }
      if (i < src.length) {
        out.push({ text: ">", cls: "tag" });
        i++;
      }
    } else if (src[i] === "{" && src[i + 1] !== "{") {
      let j = src.indexOf("}", i);
      j = j < 0 ? src.length : j + 1;
      out.push({ text: src.slice(i, j), cls: "fn" });
      i = j;
    } else {
      let j = i + 1;
      while (j < src.length && src[j] !== "<" && src[j] !== "{") j++;
      out.push({ text: src.slice(i, j) });
      i = j;
    }
  }
  return out;
}

function css(src: string): Token[] {
  const out: Token[] = [];
  const re = /\/\*[\s\S]*?(\*\/|$)|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|-?\d[\d.]*(?:px|rem|em|%|vh|vw|s|ms|deg)?|[\w-]+(?=\s*:)|[^\s\S]|[\s\S]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const t = m[0];
    const cls: Token["cls"] = t.startsWith("/*") ? "com" : t[0] === '"' || t[0] === "'" ? "str" : /^-?\d/.test(t) ? "num" : /^[\w-]+$/.test(t) && /^\s*:/.test(src.slice(m.index + t.length)) ? "attr" : undefined;
    out.push({ text: t, cls });
  }
  return out;
}

/** The file's lines as tokens. */
export function highlight(src: string, lang: Lang): Token[][] {
  const tokens = lang === "js" ? js(src) : lang === "html" || lang === "xml" ? markup(src) : lang === "css" ? css(src) : [{ text: src }];
  return byLine(tokens);
}
