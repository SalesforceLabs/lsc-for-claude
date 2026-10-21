/**
 * Static checks for LSC custom script code (the IIFE that lives in a script's LWC and in `CodeText`).
 *
 * Pure: the only dependency is `acorn`, so the renderer keeps a byte-identical copy
 * (`src-renderer/components/studio/scripts/script-checks.ts`, kept equal by a test) and the editor shows
 * the same findings live that the review dialog and the library count.
 *
 * Every rule has a stable `id`. Messages are one plain sentence; `detail` says why it matters.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as acorn from "acorn";

export type ScriptType = "Validation" | "Checklist" | "VisitActionValidation";

export interface ScriptCheckContext {
  type: ScriptType;
  objectName?: string | null;
  operationEventType?: string | null;
}

export interface ScriptDiagnostic {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  /** Character offsets into the code ((0, 0) for the whole script). */
  from: number;
  to: number;
  fix?: { label: string; changes: { from: number; to: number; insert: string }[] };
}

/** CodeText's size limit; a script over it can't be stored. */
export const CODE_TEXT_LIMIT = 131072;
/** Past this size the platform gets slow to load and run the script. */
export const CODE_SIZE_WARN = 60_000;

type N = acorn.Node & Record<string, any>;

const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "fetch",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "setTimeout",
  "setInterval",
]);
const DB_ASYNC = /^(noNs_)?(query|rowById)$/;
const FIELD_ACCESSORS = new Set(["stringValue", "numValue", "boolValue", "dateValue"]);

// --- Tree helpers ------------------------------------------------------------------------

function children(node: N): N[] {
  const out: N[] = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") out.push(c);
    } else if (v && typeof v.type === "string") {
      out.push(v);
    }
  }
  return out;
}

/** Visit every node, with its parent. */
function walk(node: N, visit: (n: N, parent: N | null) => void, parent: N | null = null): void {
  visit(node, parent);
  for (const c of children(node)) walk(c, visit, node);
}

const isFunction = (n: N) =>
  n.type === "FunctionExpression" ||
  n.type === "ArrowFunctionExpression" ||
  n.type === "FunctionDeclaration";

function patternNames(p: N | null, into: Set<string>): void {
  if (!p) return;
  switch (p.type) {
    case "Identifier":
      into.add(p.name);
      break;
    case "ObjectPattern":
      for (const prop of p.properties)
        patternNames(prop.type === "RestElement" ? prop.argument : prop.value, into);
      break;
    case "ArrayPattern":
      for (const el of p.elements) patternNames(el, into);
      break;
    case "AssignmentPattern":
      patternNames(p.left, into);
      break;
    case "RestElement":
      patternNames(p.argument, into);
      break;
  }
}

/** Names the script declares itself (variables, functions, parameters), so a local `fetch` isn't flagged. */
function declaredNames(root: N): Set<string> {
  const names = new Set<string>();
  walk(root, (n) => {
    if (n.type === "VariableDeclarator") patternNames(n.id, names);
    else if (isFunction(n)) {
      if (n.id) names.add(n.id.name);
      for (const p of n.params) patternNames(p, names);
    } else if (n.type === "ClassDeclaration" && n.id) names.add(n.id.name);
    else if (n.type === "CatchClause") patternNames(n.param, names);
  });
  return names;
}

/** `a.b` as a pair, when the member isn't computed. */
function memberOf(n: N | null | undefined): { object: N; property: string; node: N } | null {
  if (!n || n.type !== "MemberExpression" || n.computed || n.property.type !== "Identifier")
    return null;
  return { object: n.object, property: n.property.name, node: n };
}

function stringArg(call: N): { value: string; node: N } | null {
  const a = call.arguments[0];
  if (a?.type === "Literal" && typeof a.value === "string") return { value: a.value, node: a };
  if (a?.type === "TemplateLiteral" && a.expressions.length === 0)
    return { value: a.quasis[0].value.cooked ?? "", node: a };
  return null;
}

/** The IIFE: an expression statement calling a function expression straight away. */
function iifeOf(stmt: N | undefined): { call: N; fn: N } | null {
  if (!stmt || stmt.type !== "ExpressionStatement") return null;
  let e: N = stmt.expression;
  // `!function(){}()` / `void (() => {})()` style wrappers
  if (e.type === "UnaryExpression") e = e.argument;
  if (e.type !== "CallExpression") return null;
  const callee: N = e.callee;
  if (callee.type === "FunctionExpression" || callee.type === "ArrowFunctionExpression")
    return { call: e, fn: callee };
  return null;
}

// --- Checks ------------------------------------------------------------------------------

export function analyzeScript(code: string, ctx: ScriptCheckContext): ScriptDiagnostic[] {
  const out: ScriptDiagnostic[] = [];
  const add = (d: ScriptDiagnostic) => out.push(d);

  if (code.length > CODE_TEXT_LIMIT) {
    add({
      id: "too-large",
      severity: "error",
      message: `The script is ${code.length.toLocaleString("en-US")} characters, over the ${CODE_TEXT_LIMIT.toLocaleString("en-US")} the platform can store.`,
      detail:
        "CodeText holds at most 131,072 characters. Split the checks, or remove what isn't needed.",
      from: 0,
      to: 0,
    });
  } else if (code.length > CODE_SIZE_WARN) {
    add({
      id: "too-large",
      severity: "warning",
      message: `The script is ${code.length.toLocaleString("en-US")} characters, which is large.`,
      detail:
        "Big scripts are slow to load on the iPad and close to the 131,072-character limit. Look for repeated code to share.",
      from: 0,
      to: 0,
    });
  }

  if (ctx.type === "VisitActionValidation") {
    if (ctx.objectName !== "ProviderVisit") {
      add({
        id: "vav-object-name",
        severity: "error",
        message:
          "This script silently won't run: a visit action validation needs the object ProviderVisit.",
        detail: `ObjectName is ${ctx.objectName ? `"${ctx.objectName}"` : "empty"}. Set it to ProviderVisit in Details.`,
        from: 0,
        to: 0,
      });
    }
    if (ctx.operationEventType !== "OnUpdate") {
      add({
        id: "vav-event-type",
        severity: "error",
        message:
          "This script silently won't run: a visit action validation needs the event OnUpdate.",
        detail: `The operation event is ${ctx.operationEventType ? `"${ctx.operationEventType}"` : "empty"}. Set it to OnUpdate in Details.`,
        from: 0,
        to: 0,
      });
    }
  }

  if (!code.trim()) {
    add({
      id: "not-iife",
      severity: "error",
      message: "The script is empty.",
      detail: "A custom script is one function that runs straight away: (() => { ... })();",
      from: 0,
      to: 0,
    });
    return sorted(out);
  }

  const comments: { start: number; end: number }[] = [];
  let program: N | null = null;
  try {
    program = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      onComment: (_block, _text, start, end) => {
        comments.push({ start, end });
      },
    }) as N;
  } catch (e) {
    const err = e as { message?: string; pos?: number };
    const pos = typeof err.pos === "number" ? Math.min(err.pos, code.length) : 0;
    add({
      id: "syntax",
      severity: "error",
      message: (err.message ?? "The code has a syntax error").replace(/\s*\(\d+:\d+\)$/, "") + ".",
      detail:
        "The platform can't run code that doesn't parse. Fix this first; the other checks resume once it does.",
      from: pos,
      to: Math.min(pos + 1, code.length),
    });
    // A comment before the code is still worth reporting without a tree.
    const lead = /^\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(code);
    if (lead) {
      const start = lead.index + lead[0].length - lead[1].length;
      addLeadingComment(out, [{ start, end: start + lead[1].length }], code.length);
    }
    return sorted(out);
  }

  const body: N[] = program.body;
  const first = body[0];
  const iife = iifeOf(first);

  // Locker Service fails silently when anything but the function comes first.
  const firstStart = first ? first.start : code.length;
  addLeadingComment(
    out,
    comments.filter((c) => c.start < firstStart),
    firstStart
  );

  if (!iife) {
    add({
      id: "not-iife",
      severity: "error",
      message: "The script isn't wrapped in an IIFE.",
      detail:
        "Write the whole script as (() => { ... })(); — the platform evaluates that one expression and uses what it returns.",
      from: first ? first.start : 0,
      to: first ? first.end : 0,
    });
  } else if (body.length > 1) {
    add({
      id: "not-iife",
      severity: "warning",
      message: "There is code outside the IIFE.",
      detail:
        "Only the first expression is evaluated reliably; put everything inside the function.",
      from: body[1].start,
      to: body[body.length - 1].end,
    });
  }

  const declared = declaredNames(program);

  let unwraps = false;
  walk(program, (n, parent) => {
    if (n.type === "CallExpression") {
      const m = memberOf(n.callee);
      // JSON.parse(JSON.stringify(...))
      if (m && isIdent(m.object, "JSON") && m.property === "parse") {
        const inner = n.arguments[0];
        const im = inner?.type === "CallExpression" ? memberOf(inner.callee) : null;
        if (im && isIdent(im.object, "JSON") && im.property === "stringify") unwraps = true;
      }

      // record.stringValue('Field__c') etc.
      if (m && FIELD_ACCESSORS.has(m.property)) {
        const arg = stringArg(n);
        if (arg && arg.value.endsWith("__c"))
          add(
            noNsDiagnostic(m.node, m.property, arg.value, `${m.property}("${arg.value}")`, "field")
          );
      }
      // db.rowById('Thing__c', id) / db.query('Thing__c', where)
      if (m && isIdent(m.object, "db") && /^(rowById|query)$/.test(m.property)) {
        const arg = stringArg(n);
        if (arg && /__(c|mdt)$/.test(arg.value))
          add(
            noNsDiagnostic(
              m.node,
              m.property,
              arg.value,
              `db.${m.property}("${arg.value}")`,
              "object"
            )
          );
      }
      // db.query(...) whose promise is dropped
      if (m && isIdent(m.object, "db") && DB_ASYNC.test(m.property) && !handled(n, parent)) {
        add({
          id: "db-without-await",
          severity: "warning",
          message: `db.${m.property}(...) returns a promise, but the result isn't awaited.`,
          detail:
            "Without await you get a pending promise, not records. Write await db.query(...) inside an async function.",
          from: n.start,
          to: n.end,
          fix: { label: "Add await", changes: [{ from: n.start, to: n.start, insert: "await " }] },
        });
      }
      // console.*
      if (m && isIdent(m.object, "console") && !declared.has("console")) {
        add({
          id: "console-log",
          severity: "info",
          message: `Use env.log instead of console.${m.property}.`,
          detail:
            "env.log writes where the platform can capture it: the browser console on the web and the device log on the iPad (JavaScriptCore has no console).",
          from: m.node.start,
          to: m.node.end,
          fix: {
            label: "Use env.log",
            changes: [{ from: m.node.start, to: m.node.end, insert: "env.log" }],
          },
        });
      }
    }

    if (n.type === "Identifier" && isReference(n, parent)) {
      if (BROWSER_GLOBALS.has(n.name) && !declared.has(n.name)) {
        add({
          id: "browser-api",
          severity: "warning",
          message: `${n.name} isn't available in custom scripts on the iPad.`,
          detail:
            "The iPad runs scripts in JavaScriptCore, which has no browser APIs (window, document, fetch, timers, storage). Use db for data and keep the logic to plain JavaScript and promises.",
          from: n.start,
          to: n.end,
        });
      }
      if (n.name === "GroupCondition" && !declared.has(n.name)) {
        add({
          id: "group-condition",
          severity: "error",
          message: "GroupCondition isn't available in custom scripts.",
          detail:
            "It isn't injected into the script's scope, so using it throws. Use AndCondition or OrCondition instead.",
          from: n.start,
          to: n.end,
        });
      }
    }
  });

  if (!unwraps) {
    const ret = iife ? topLevelReturns(iife.fn)[0] : undefined;
    add({
      id: "no-unwrap",
      severity: "warning",
      message: "Results aren't unwrapped with JSON.parse(JSON.stringify(...)).",
      detail:
        "Pass what you return through JSON.parse(JSON.stringify(...)) so Locker Service proxies (web) and JavaScriptCore bridge objects (iPad) come back as plain data.",
      from: ret ? ret.start : 0,
      to: ret ? ret.end : 0,
    });
  }

  if (ctx.type === "VisitActionValidation" && !hasGlobalGuard(code)) {
    add({
      id: "no-global-guard",
      severity: "info",
      message: "The script doesn't check that record, user, env and db exist before using them.",
      detail:
        "A guard such as if (record && user && env && db) keeps the script from throwing when the app runs it without one of them.",
      from: 0,
      to: 0,
    });
  }

  if (iife) {
    const finding = returnsFinding(iife.fn);
    if (finding) add({ id: "returns-non-array", severity: "info", ...finding });
  }

  return sorted(out);
}

const isIdent = (n: N, name: string) => n.type === "Identifier" && n.name === name;

function hasGlobalGuard(code: string): boolean {
  return /\bif\s*\(\s*!\s*(record|user|env|db)\b|\bif\s*\(\s*\(?\s*(record|user|env|db)\s*&&|\btypeof\s+(record|user|env|db)\b|\b(record|user|env|db)\s*&&\s*(record|user|env|db)\b/.test(
    code
  );
}

function sorted(list: ScriptDiagnostic[]): ScriptDiagnostic[] {
  const rank = { error: 0, warning: 1, info: 2 };
  return list.sort((a, b) => a.from - b.from || rank[a.severity] - rank[b.severity]);
}

function addLeadingComment(
  out: ScriptDiagnostic[],
  lead: { start: number; end: number }[],
  firstStart: number
): void {
  if (lead.length === 0) return;
  out.push({
    id: "comment-before-iife",
    severity: "error",
    message: "A comment before the IIFE makes the script fail silently.",
    detail:
      "Locker Service evaluates the script's first expression. With a comment ahead of it the script runs nothing and reports nothing. Put comments inside the function.",
    from: lead[0].start,
    to: lead[lead.length - 1].end,
    fix: {
      label: "Remove the comment",
      changes: lead.map((c, i) => ({
        from: c.start,
        to: lead[i + 1]?.start ?? firstStart,
        insert: "",
      })),
    },
  });
}

function noNsDiagnostic(
  member: N,
  method: string,
  name: string,
  call: string,
  what: "field" | "object"
): ScriptDiagnostic {
  const prop = member.property as N;
  return {
    id: "custom-field-stringvalue",
    severity: "warning",
    message:
      what === "field"
        ? `${call} won't find a customer-created field; use noNs_${method}.`
        : `${call} adds the managed package's namespace to ${name}; use noNs_${method}.`,
    detail:
      "Methods without noNs_ add the LSC managed-package namespace. That is right for package fields, but fields and objects the customer created (ending __c or __mdt) have no namespace, so the lookup returns null.",
    from: prop.start,
    to: prop.end,
    fix: {
      label: `Use noNs_${method}`,
      changes: [{ from: prop.start, to: prop.end, insert: `noNs_${method}` }],
    },
  };
}

/** Whether a promise-returning call's result is dealt with where it stands (awaited, returned, chained, collected). */
function handled(call: N, parent: N | null): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "AwaitExpression":
    case "ReturnStatement":
    case "ArrayExpression":
      return true;
    case "ArrowFunctionExpression":
      return parent.body === call;
    case "CallExpression":
      return parent.callee !== call; // an argument, e.g. Promise.all(db.query(...))
    case "MemberExpression":
      return parent.object === call; // .then(...) / .catch(...)
    default:
      return false;
  }
}

/** Identifier nodes that read a variable (not property names or keys). */
function isReference(n: N, parent: N | null): boolean {
  if (!parent) return true;
  if (parent.type === "MemberExpression" && parent.property === n && !parent.computed) return false;
  if (
    (parent.type === "Property" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "MethodDefinition") &&
    parent.key === n &&
    !parent.computed
  ) {
    return parent.shorthand === true && parent.value === n;
  }
  if (
    parent.type === "LabeledStatement" ||
    parent.type === "BreakStatement" ||
    parent.type === "ContinueStatement"
  )
    return false;
  return true;
}

/** `return` statements belonging to this function (not nested ones). */
function topLevelReturns(fn: N): N[] {
  const found: N[] = [];
  const visit = (n: N) => {
    for (const c of children(n)) {
      if (isFunction(c)) continue;
      if (c.type === "ReturnStatement") found.push(c);
      visit(c);
    }
  };
  if (fn.body.type === "BlockStatement") visit(fn.body);
  return found;
}

/** Best effort: the IIFE's return value is expected to be an array of results (or of promises). */
function returnsFinding(
  fn: N
): { message: string; detail: string; from: number; to: number } | null {
  const detail =
    "The app reads the script's value as a list of results — [{ title, status }] — or a list of promises for them. Return an array, even for one result.";
  let arg: N;
  if (fn.body.type !== "BlockStatement") {
    arg = fn.body;
  } else {
    const returns = topLevelReturns(fn);
    if (returns.length === 0)
      return { message: "The IIFE doesn't return anything.", detail, from: fn.start, to: fn.end };
    // Only the last return is judged: earlier ones are usually early exits.
    const at = returns[returns.length - 1];
    if (!at.argument)
      return { message: "The IIFE returns nothing.", detail, from: at.start, to: at.end };
    arg = at.argument;
  }
  // JSON.parse(JSON.stringify(x)) → x
  for (;;) {
    const m = arg.type === "CallExpression" ? memberOf(arg.callee) : null;
    const inner: N | undefined = arg.arguments?.[0];
    if (
      m &&
      isIdent(m.object, "JSON") &&
      m.property === "parse" &&
      inner?.type === "CallExpression"
    ) {
      const im = memberOf(inner.callee);
      if (im && isIdent(im.object, "JSON") && im.property === "stringify" && inner.arguments[0]) {
        arg = inner.arguments[0];
        continue;
      }
    }
    break;
  }
  const nonArray = (n: N) =>
    n.type === "ObjectExpression" || n.type === "Literal" || n.type === "TemplateLiteral";
  if (nonArray(arg))
    return {
      message: "The IIFE returns a single value instead of an array.",
      detail,
      from: arg.start,
      to: arg.end,
    };
  if (arg.type === "Identifier") {
    const name = arg.name;
    let init: N | null = null;
    walk(fn, (n) => {
      if (
        n.type === "VariableDeclarator" &&
        n.id.type === "Identifier" &&
        n.id.name === name &&
        n.init
      )
        init = n.init;
    });
    const i = init as N | null;
    if (i && nonArray(i))
      return {
        message: `The IIFE returns ${name}, which isn't an array.`,
        detail,
        from: arg.start,
        to: arg.end,
      };
  }
  return null;
}
