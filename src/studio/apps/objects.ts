/** The objects an app's source reads: GraphQL `uiapi.query.<Object>` roots and `@salesforce/schema/<Object>.<Field>` imports. */

import { blankJsComments, gqlTemplates } from "./lint.js";
import type { AppFile } from "./types.js";

/** Top-level fields of the `query { … }` block under `uiapi`, ignoring aliases' left sides. */
function graphqlRoots(text: string): string[] {
  const out: string[] = [];
  const m = /\buiapi\s*\{\s*query\s*\{/.exec(text);
  if (!m) return out;
  let depth = 1;
  let i = m.index + m[0].length;
  let token = "";
  for (; i < text.length && depth > 0; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 1 && token) out.push(token);
      depth++;
      token = "";
    } else if (c === "}") {
      depth--;
      token = "";
    } else if (c === "(") {
      // Arguments: skip to the matching paren, then the selection follows.
      if (depth === 1 && token) out.push(token);
      let p = 1;
      for (i++; i < text.length && p > 0; i++) {
        if (text[i] === "(") p++;
        else if (text[i] === ")") p--;
      }
      i--;
      token = "";
    } else if (depth === 1) {
      if (/[\w]/.test(c)) token += c;
      else if (c === ":") token = ""; // `alias: Object` — the name after the colon is the object
      else if (!/\s/.test(c)) token = "";
    }
  }
  return out;
}

/** API names of the objects the files read, in order of first use, without duplicates. */
export function objectsRead(files: AppFile[], objectApiName?: string): string[] {
  const names = new Set<string>();
  if (objectApiName && /^\w+$/.test(objectApiName)) names.add(objectApiName);
  for (const f of files) {
    if (!f.path.endsWith(".js")) continue;
    const js = blankJsComments(f.source);
    for (const q of gqlTemplates(js)) for (const o of graphqlRoots(q.text)) names.add(o);
    // Dynamic query strings (plain template literals passed to graphql()) still name their roots.
    for (const m of js.matchAll(/\buiapi\s*\{\s*query\s*\{\s*(?:\w+\s*:\s*)?(\w+)/g)) names.add(m[1]);
    for (const m of js.matchAll(/["']@salesforce\/schema\/(\w+)(?:\.\w+)?["']/g)) names.add(m[1]);
  }
  return [...names];
}
