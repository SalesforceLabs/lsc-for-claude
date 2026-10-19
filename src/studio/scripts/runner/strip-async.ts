/**
 * The iPad app removes `async` / `await` from a script before running it (its
 * `db` calls complete synchronously). This does the same, replacing each
 * keyword with spaces so line and column numbers stay where they were.
 */

import * as acorn from "acorn";

interface Node {
  type: string;
  start: number;
  end: number;
  async?: boolean;
  method?: boolean;
  key?: Node;
  value?: Node;
  [key: string]: unknown;
}

/** Returns the code unchanged when it doesn't parse (the sandbox reports the syntax error). */
export function stripAsync(code: string): string {
  let ast: Node;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: "latest",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    }) as unknown as Node;
  } catch {
    return code;
  }
  const chars = code.split("");
  const blank = (from: number, len: number) => {
    for (let i = from; i < from + len && i < chars.length; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Node;
    if (typeof n.type === "string") {
      if (n.type === "AwaitExpression") blank(n.start, 5);
      if (/Function/.test(n.type) && n.async && code.startsWith("async", n.start)) blank(n.start, 5);
      if ((n.type === "MethodDefinition" || n.type === "Property") && n.value?.async && n.key) {
        const m = /\basync\b/.exec(code.slice(n.start, n.key.start));
        if (m) blank(n.start + m.index, 5);
      }
    }
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
  };
  visit(ast);
  return chars.join("");
}
