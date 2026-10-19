/**
 * Runs a custom script in a Node `vm` context against a real org, read-only.
 *
 * `db` calls inside the sandbox are synchronous. Anything the script asks for
 * that isn't cached yet is recorded as a miss and answered with an empty
 * result; after the pass the misses are fetched and the whole script runs
 * again from scratch. The last pass's logs, writes and result are the ones
 * reported. Time and randomness are fixed in the sandbox so every pass builds
 * the same queries.
 */

import vm from "node:vm";
import { PRELUDE_SOURCE } from "./prelude.js";
import { stripAsync } from "./strip-async.js";
import { pickFields, plainRow } from "./fields.js";
import {
  RUN_LIMITS,
  type OrgReader,
  type Platform,
  type Row,
  type ScriptLogLine,
  type ScriptQueryLog,
  type ScriptRecordedWrite,
  type ScriptTestRequest,
  type ScriptTestResult,
  type ScriptType,
} from "./types.js";

export interface RunInput {
  code: string;
  type: ScriptType;
  platform: Platform;
  env?: ScriptTestRequest["env"];
  record: { object: string; fields: Row; rt?: string | null };
  user: { fields: Row; rt?: string | null };
  contextData: unknown | null;
  /** E.g. "lsc4ce__" when the org has the managed package; applied on iPad only. */
  nsPrefix: string | null;
  reader: OrgReader;
  /** Notes from building the inputs (missing objects, inferred keys, ...). */
  notes?: string[];
  /** Fixed "now" (ms) so replays and tests are stable. */
  now?: number;
}

const WRAP_PREFIX = "__lscRun(function(){return ";
const STATUSES = new Set(["success", "warning", "error"]);

interface Miss {
  kind: "query" | "describe";
  args: { entity: string; where?: string; fields?: string[] | null };
}

interface DonePayload {
  error?: { message: string; stack?: string };
  raw?: { type: string; isArray: boolean; thenable: boolean; elThenable: boolean };
  leak?: boolean;
  valueType?: string;
  elTypes?: string[] | null;
  valueJson?: string | null;
}

function lineOf(stack: string | undefined): { line?: number; column?: number } {
  const m = stack ? /script\.js:(\d+):(\d+)/.exec(stack) : null;
  if (!m) return {};
  const line = Number(m[1]);
  const col = Number(m[2]);
  return { line, column: line === 1 ? Math.max(1, col - WRAP_PREFIX.length) : col };
}

function syntaxInfo(err: Error): { message: string; line?: number; column?: number; stack?: string } {
  const stack = err.stack ?? "";
  const m = /^script\.js:(\d+)\n([^\n]*)\n(\s*)\^/m.exec(stack);
  if (!m) return { message: err.message, stack };
  const line = Number(m[1]);
  const col = m[3].length + 1;
  return { message: err.message, line, column: line === 1 ? Math.max(1, col - WRAP_PREFIX.length) : col, stack };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer = setTimeout(() => rej(new Error("timeout")), Math.max(1, ms));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runScript(input: RunInput): Promise<ScriptTestResult> {
  const started = Date.now();
  const notes: string[] = [];
  const noteSet = new Set<string>();
  const addNote = (n: string) => {
    if (!noteSet.has(n)) {
      noteSet.add(n);
      notes.push(n);
    }
  };
  addNote(
    "This is a simulation, run as the connected admin, not as the rep. Sharing, field-level security and territory access aren't applied, and nothing is written to the org.",
  );
  for (const n of input.notes ?? []) addNote(n);
  const queries: ScriptQueryLog[] = [];
  const cache = new Map<string, string>();
  const inflight = new Map<string, Promise<void>>();
  const drain = new vm.Script("0", { filename: "drain.js" });
  const rtCache = new Map<string, Map<string, string>>();
  const describeCache = new Map<string, Awaited<ReturnType<OrgReader["describe"]>>>();
  let queryCount = 0;
  let cpuUsed = 0;
  let timedOut: string | null = null;

  const base = (extra: Partial<ScriptTestResult>): ScriptTestResult => ({
    ok: false,
    results: [],
    outcome: "none",
    logs: [],
    queries,
    contract: [],
    durationMs: Date.now() - started,
    notes,
    ...extra,
  });

  let code = input.code;
  if (input.platform === "ipad") {
    code = stripAsync(code);
    addNote("iPad: async and await are removed before the script runs, so db calls complete synchronously and selectedFields is ignored.");
    addNote("iPad: because db calls are synchronous, the simulation replays the script as it learns which queries it needs; the clock reads the time the run started and doesn't advance, and Math.random() is seeded, so every replay builds the same queries.");
    if (input.nsPrefix) addNote(`iPad: ${input.nsPrefix} is added to custom object and field names unless the _noNs variant is used.`);
  } else {
    addNote("Web: rows are wrapped like Locker Service proxies; unwrap them (JSON.parse(JSON.stringify(...))) before returning them.");
  }

  let compiled: vm.Script;
  try {
    compiled = new vm.Script(`${WRAP_PREFIX}${code}\n})`, { filename: "script.js" });
  } catch (e) {
    return base({ error: syntaxInfo(e as Error) });
  }

  // ---- org reads (host side) ----
  const describe = async (entity: string) => {
    if (!describeCache.has(entity)) {
      let info = null;
      try {
        info = await input.reader.describe(entity);
      } catch {
        info = null;
      }
      describeCache.set(entity, info);
    }
    return describeCache.get(entity) ?? null;
  };

  const recordTypes = async (entity: string): Promise<Map<string, string>> => {
    let m = rtCache.get(entity);
    if (m) return m;
    m = new Map();
    try {
      const rows = await input.reader.query(`SELECT Id, Name FROM RecordType WHERE SobjectType = '${entity}'`);
      for (const r of rows) m.set(String(r.Id), String(r.Name));
    } catch {
      /* object has no record types */
    }
    rtCache.set(entity, m);
    return m;
  };

  const fetchMiss = async (key: string, miss: Miss) => {
    const entity = miss.args.entity;
    if (typeof entity !== "string" || !/^[A-Za-z0-9_]+$/.test(entity)) {
      cache.set(key, JSON.stringify({ ok: false, error: `Invalid object name: ${String(entity)}` }));
      return;
    }
    const info = await describe(entity);
    if (miss.kind === "describe") {
      cache.set(key, JSON.stringify({ ok: true, fields: info ? info.fields.map((f) => f.name) : null }));
      return;
    }
    const where = (miss.args.where ?? "").trim();
    let soql = "";
    const t0 = Date.now();
    try {
      if (queryCount >= RUN_LIMITS.maxQueries) {
        throw new Error(`Query limit reached: a test run reads at most ${RUN_LIMITS.maxQueries} different queries.`);
      }
      queryCount++;
      if (!info) throw new Error(`sObject type '${entity}' is not supported or isn't visible to the connected admin.`);
      let fields: string[];
      if (miss.args.fields && miss.args.fields.length) {
        const known = new Map(info.fields.map((f) => [f.name.toLowerCase(), f.name]));
        const set = new Set<string>(["Id"]);
        for (const f of miss.args.fields) {
          const real = known.get(String(f).toLowerCase());
          if (real) set.add(real);
        }
        fields = [...set];
      } else {
        const picked = pickFields(info);
        fields = picked.fields;
        if (picked.capped) addNote(`${entity} has more than ${RUN_LIMITS.maxFields} fields; the simulation reads the first ${RUN_LIMITS.maxFields}.`);
      }
      soql = `SELECT ${fields.join(", ")} FROM ${entity}`;
      if (where) soql += ` WHERE ${where}`;
      if (!/\blimit\s+\d+/i.test(where)) soql += ` LIMIT ${RUN_LIMITS.rowsPerQuery + 1}`;
      const rows = await input.reader.query(soql);
      let used = rows;
      if (rows.length > RUN_LIMITS.rowsPerQuery) {
        used = rows.slice(0, RUN_LIMITS.rowsPerQuery);
        addNote(`${entity}: the query matched more than ${RUN_LIMITS.rowsPerQuery} rows; the simulation keeps the first ${RUN_LIMITS.rowsPerQuery}.`);
      }
      let rts: Map<string, string> | null = null;
      if (used.some((r) => r.RecordTypeId)) rts = await recordTypes(entity);
      const items = used.map((r) => {
        const item: { fields: Row; rt?: string } = { fields: plainRow(r) };
        const rt = r.RecordTypeId && rts ? rts.get(String(r.RecordTypeId)) : undefined;
        if (rt) item.rt = rt;
        return item;
      });
      queries.push({ object: entity, soql, rows: used.length, ms: Date.now() - t0 });
      cache.set(key, JSON.stringify({ ok: true, rows: items }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      queries.push({ object: entity, soql: soql || `(${entity}${where ? " WHERE " + where : ""})`, rows: 0, ms: Date.now() - t0, error: msg });
      cache.set(key, JSON.stringify({ ok: false, error: msg }));
    }
  };

  // ---- passes ----
  let logs: ScriptLogLine[] = [];
  let writes: ScriptRecordedWrite[] = [];
  let done: DonePayload | null = null;
  let scriptError: ScriptTestResult["error"];
  let passes = 0;

  for (; passes < RUN_LIMITS.maxPasses; passes++) {
    logs = [];
    writes = [];
    done = null;
    scriptError = undefined;
    const misses = new Map<string, Miss>();
    let usedLabel = false;
    let passStart = Date.now();
    let settled = false;
    const cfg = JSON.stringify({
      platform: input.platform,
      nsPrefix: input.nsPrefix ?? "",
      now: input.now ?? started,
      env: { ...(input.env ?? {}) },
      record: { fields: input.record.fields, rt: input.record.rt ?? null },
      recordObject: input.record.object,
      user: { fields: input.user.fields, rt: null },
      contextData: input.contextData ?? null,
    });
    let settle: () => void = () => {};
    const finished = new Promise<void>((r) => {
      settle = r;
    });
    let outstanding = 0;
    const host = {
      cfg: () => cfg,
      // Web: a real Promise in the sandbox is settled from here when the query returns.
      queryAsync: (kind: string, argsJson: string, cb: (s: string) => void) => {
        const key = `${kind}|${argsJson}`;
        outstanding++;
        let work = inflight.get(key);
        if (!work && !cache.has(key)) {
          work = fetchMiss(key, { kind: kind as Miss["kind"], args: JSON.parse(argsJson) });
          inflight.set(key, work);
        }
        void (work ?? Promise.resolve()).then(() => {
          outstanding--;
          if (timedOut || settled) return;
          const t0 = Date.now();
          try {
            cb(cache.get(key) ?? '{"ok":false,"error":"No result."}');
            drain.runInContext(ctx, { timeout: Math.max(50, RUN_LIMITS.cpuMs - cpuUsed) });
          } catch (e) {
            if ((e as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
              timedOut = `The script ran past the ${RUN_LIMITS.cpuMs / 1000} s CPU limit and was stopped.`;
            }
          }
          cpuUsed += Date.now() - t0;
          if (timedOut || done || outstanding === 0) settle();
        });
      },
      query: (kind: string, argsJson: string): string => {
        const key = `${kind}|${argsJson}`;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        misses.set(key, { kind: kind as Miss["kind"], args: JSON.parse(argsJson) });
        return kind === "describe" ? '{"ok":true,"fields":null,"miss":true}' : '{"ok":true,"rows":[],"miss":true}';
      },
      log: (level: string, text: string) => {
        logs.push({ level: level === "warn" || level === "error" ? level : "log", text: String(text), at: Date.now() - started });
      },
      write: (json: string) => {
        writes.push(JSON.parse(json) as ScriptRecordedWrite);
      },
      note: (label: string) => {
        if (label === "label") usedLabel = true;
      },
      done: (json: string) => {
        if (!done) done = JSON.parse(json) as DonePayload;
        settle();
      },
    };

    const ctx = vm.createContext(Object.create(null), {
      microtaskMode: "afterEvaluate",
      codeGeneration: { strings: false, wasm: false },
    });
    const remaining = Math.max(50, RUN_LIMITS.cpuMs - cpuUsed);
    try {
      const init = new vm.Script(PRELUDE_SOURCE, { filename: "prelude.js" }).runInContext(ctx, { timeout: remaining }) as (h: unknown) => void;
      init(host);
      compiled.runInContext(ctx, { timeout: remaining });
      if (input.platform === "web" && !done && outstanding > 0) {
        // Real async: the script awaits host promises; wait for it to finish within the total time.
        cpuUsed += Date.now() - passStart;
        const left = RUN_LIMITS.totalMs - (Date.now() - started);
        let timer: NodeJS.Timeout | undefined;
        const out = await Promise.race([
          finished.then(() => "ok"),
          new Promise<string>((r) => {
            timer = setTimeout(() => r("total"), Math.max(1, left));
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (out === "total") {
          timedOut = `The run took longer than ${RUN_LIMITS.totalMs / 1000} s in total and was stopped.`;
        }
        settled = true;
        passStart = Date.now();
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        timedOut = `The script ran past the ${RUN_LIMITS.cpuMs / 1000} s CPU limit and was stopped.`;
      } else if (!done) {
        scriptError = { message: err.message, ...lineOf(err.stack), stack: err.stack };
      }
    }
    cpuUsed += Date.now() - passStart;
    if (usedLabel) addNote("env.formatCustomLabel returns the default text with {n} and %@ filled in; translations aren't looked up.");
    if (timedOut) break;
    if (misses.size === 0) break;
    const left = RUN_LIMITS.totalMs - (Date.now() - started);
    if (left <= 0) {
      timedOut = `The run took longer than ${RUN_LIMITS.totalMs / 1000} s in total and was stopped.`;
      break;
    }
    try {
      // Describes first: queries reuse them.
      const entries = [...misses.entries()];
      await withTimeout(
        Promise.all(entries.filter(([, m]) => m.kind === "describe").map(([k, m]) => fetchMiss(k, m))).then(() =>
          Promise.all(entries.filter(([, m]) => m.kind === "query").map(([k, m]) => fetchMiss(k, m))),
        ),
        left,
      );
    } catch {
      timedOut = `The run took longer than ${RUN_LIMITS.totalMs / 1000} s in total and was stopped.`;
      break;
    }
  }
  if (passes >= RUN_LIMITS.maxPasses) {
    addNote(`The script was replayed ${RUN_LIMITS.maxPasses} times and still asked for new data; the result may be incomplete.`);
  }
  if (writes.length) addNote("setValue / save calls were recorded, not applied to the org.");

  const durationMs = Date.now() - started;
  const finalDone = done as DonePayload | null;
  if (timedOut) return base({ error: { message: timedOut }, logs, recorded: writes, durationMs });
  if (scriptError) return base({ error: scriptError, logs, recorded: writes, durationMs });
  if (!finalDone) {
    return base({
      logs,
      recorded: writes,
      durationMs,
      contract: ["The script never finished: it returned a promise that doesn't resolve (or returned nothing). Return the array of results, or a promise for it."],
    });
  }
  if (finalDone.error) {
    return base({ error: { message: finalDone.error.message, ...lineOf(finalDone.error.stack), stack: finalDone.error.stack }, logs, recorded: writes, durationMs });
  }

  // ---- the output contract ----
  const contract: string[] = [];
  const raw = finalDone.raw ?? { type: "undefined", isArray: false, thenable: false, elThenable: false };
  let value: unknown = null;
  try {
    value = finalDone.valueJson ? JSON.parse(finalDone.valueJson) : null;
  } catch {
    value = null;
  }
  if (input.platform === "ipad" && raw.thenable) {
    contract.push("The script returned a Promise. The iPad app removes async/await and doesn't wait for promises, so return the array directly.");
  }
  if (input.platform === "ipad" && raw.elThenable) {
    contract.push("The returned array contains Promises. On iPad they aren't awaited; build plain { title, status } objects.");
  }
  const results: ScriptTestResult["results"] = [];
  let usable = true;
  if (!Array.isArray(value)) {
    usable = false;
    contract.push(
      raw.type === "undefined" || finalDone.valueJson == null
        ? "The script returned nothing. It must return an array of { title, status } objects. A comment before the IIFE also makes the script return undefined."
        : `The script returned ${finalDone.valueType === "object" ? "an object" : `a ${finalDone.valueType}`}, not an array. It must return an array of { title, status } objects.`,
    );
  } else {
    // A web script returns [validateVisit()], which resolves to an array of its own: the app flattens one level.
    const flat: { el: unknown; t?: string }[] = [];
    value.forEach((el, i) => {
      if (Array.isArray(el)) el.forEach((inner) => flat.push({ el: inner }));
      else flat.push({ el, t: finalDone.elTypes?.[i] });
    });
    flat.forEach(({ el, t }, i) => {
      if (t === "function" || t === "undefined") {
        contract.push(`Result ${i + 1} is ${t === "function" ? "a function" : "undefined"}, not a { title, status } object.`);
        return;
      }
      if (el === null || typeof el !== "object" || Array.isArray(el)) {
        contract.push(`Result ${i + 1} is not a { title, status } object.`);
        return;
      }
      const o = el as { title?: unknown; status?: unknown };
      if (typeof o.title !== "string") {
        contract.push(`Result ${i + 1} has no string title.`);
        return;
      }
      if (typeof o.status !== "string" || !STATUSES.has(o.status)) {
        contract.push(`Result ${i + 1} ("${o.title}") has status ${JSON.stringify(o.status)}; use "success", "warning" or "error".`);
      }
      results.push({ title: o.title, status: typeof o.status === "string" ? o.status : "" });
    });
  }
  if (input.platform === "web" && finalDone.leak) {
    contract.push("The returned value still contains Locker Service proxies. Copy the data out first (JSON.parse(JSON.stringify(...))) or the app can't read it.");
  }

  let outcome: ScriptTestResult["outcome"] = "none";
  if (usable) {
    const hasError = results.some((r) => r.status === "error");
    const hasWarning = results.some((r) => r.status === "warning");
    if (input.type === "Checklist") outcome = hasError || hasWarning ? "warn" : "pass";
    else outcome = hasError ? "block" : hasWarning ? "warn" : "pass";
  }
  return {
    ok: usable && contract.length === 0,
    results,
    outcome,
    logs,
    queries,
    contract,
    durationMs,
    notes,
    recorded: writes,
  };
}
