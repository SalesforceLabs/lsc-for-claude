// Pure helpers for the script test panel: wording, tones and option labels. No React, no IPC.
import type { StatusTone } from "../../ui/StatusIcon";

export type TestScriptType = "Validation" | "Checklist" | "VisitActionValidation";
export type TestPlatform = "web" | "ipad";
export type TestOutcome = "pass" | "warn" | "block" | "none";

export interface TestEnv {
  actionName?: string;
  fromStatus?: string;
  toStatus?: string;
}

export interface TestRecord {
  id: string;
  objectName: string;
  name: string;
  accountName: string | null;
  date: string | null;
  status: string | null;
  children: { object: string; label: string; count: number }[];
}

/** The server's run result (src/studio/scripts/runner/types.ts), with the optional recorded writes. */
export interface TestRunResult {
  ok: boolean;
  results: { title: string; status: string }[];
  outcome: TestOutcome;
  logs: { level: "log" | "warn" | "error"; text: string; at: number }[];
  queries: { object: string; soql: string; rows: number; ms: number; error?: string }[];
  error?: { message: string; line?: number; column?: number; stack?: string };
  contract: string[];
  durationMs: number;
  notes: string[];
  recorded?: { op?: string; text?: string; [key: string]: unknown }[];
}

export interface EnvField {
  key: keyof TestEnv;
  label: string;
  placeholder: string;
}

const DEFAULT_ACTION = "Submit";

/** Environment inputs a script of this type can read: visit scripts see the action; workflow scripts also the status change. */
export function envFields(type: TestScriptType): EnvField[] {
  if (type === "VisitActionValidation") return [{ key: "actionName", label: "Action", placeholder: DEFAULT_ACTION }];
  return [
    { key: "actionName", label: "Action", placeholder: "e.g. Submit" },
    { key: "fromStatus", label: "From status", placeholder: "e.g. Draft" },
    { key: "toStatus", label: "To status", placeholder: "e.g. Submitted" },
  ];
}

/** The env sent with a run: blank inputs are left out, and a visit script defaults to Submit. */
export function cleanEnv(type: TestScriptType, env: TestEnv): TestEnv {
  const out: TestEnv = {};
  for (const f of envFields(type)) {
    const v = env[f.key]?.trim();
    if (v) out[f.key] = v;
  }
  if (type === "VisitActionValidation" && !out.actionName) out.actionName = DEFAULT_ACTION;
  return out;
}

/** The records tool needs an object for every type but visit actions. */
export function needsObject(type: TestScriptType, objectName: string | null): boolean {
  return type !== "VisitActionValidation" && !objectName;
}

export function canRun(type: TestScriptType, objectName: string | null, code: string, recordId: string | null): boolean {
  return !!recordId && code.trim().length > 0 && !needsObject(type, objectName);
}

export function statusTone(status: string): StatusTone {
  if (status === "success") return "pass";
  if (status === "warning") return "warning";
  if (status === "error") return "error";
  return "unknown";
}

export interface Headline {
  tone: StatusTone;
  title: string;
  detail?: string;
}

/** The one line the result opens with: what the rep would see. */
export function headline(result: TestRunResult, type: TestScriptType, env: TestEnv = {}): Headline {
  if (result.error) return { tone: "error", title: "The script threw an error", detail: result.error.message };
  if (result.outcome === "none") {
    return { tone: "unknown", title: "The script's result can't be used", detail: result.contract[0] };
  }
  const action = env.actionName?.trim() || (type === "VisitActionValidation" ? DEFAULT_ACTION : "");
  const warn = result.results.filter((r) => r.status === "warning").length;
  const err = result.results.filter((r) => r.status === "error").length;
  let h: Headline;
  if (result.outcome === "block") {
    h = { tone: "error", title: action ? `Would block ${action}` : "Would block the rep", detail: countLine(err, "error") };
  } else if (result.outcome === "warn") {
    h =
      type === "Checklist"
        ? { tone: "warning", title: "Would show open checklist items", detail: countLine(err + warn, "item") }
        : { tone: "warning", title: "Would warn, rep can continue", detail: countLine(warn, "warning") };
  } else {
    h = { tone: "pass", title: "Passes", detail: result.results.length ? undefined : "The script returned no results." };
  }
  if (result.contract.length) h.detail = [h.detail, "It breaks the output contract."].filter(Boolean).join(" ");
  return h;
}

function countLine(n: number, noun: string): string | undefined {
  return n > 0 ? `${n} ${noun}${n === 1 ? "" : "s"}` : undefined;
}

/** "line 12, column 5" for the error banner; null without a line. */
export function formatLocation(error: { line?: number; column?: number } | undefined): string | null {
  if (!error?.line) return null;
  return error.column ? `line ${error.line}, column ${error.column}` : `line ${error.line}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE_FORMAT.format(d);
}

/** "2 details · 1 sample" from the record's child counts, skipping zeros. */
export function childSummary(children: TestRecord["children"]): string {
  return children
    .filter((c) => c.count > 0)
    .map((c) => `${c.count.toLocaleString("en-US")} ${c.count === 1 ? c.label.replace(/s$/, "") : c.label}`)
    .join(" · ");
}

export interface RecordOption {
  value: string;
  label: string;
  detail: string;
}

export function recordOption(r: TestRecord): RecordOption {
  const detail = [r.accountName, formatDate(r.date), r.status, childSummary(r.children)].filter(Boolean).join(" · ");
  return { value: r.id, label: r.name || r.id, detail };
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The prompt Ask Roz gets for a failing run is built by the editor; this is the short label of what failed. */
export function failureKind(result: TestRunResult): "error" | "contract" | "block" | "warn" | "pass" {
  if (result.error) return "error";
  if (result.outcome === "none" || result.contract.length) return "contract";
  return result.outcome === "block" ? "block" : result.outcome === "warn" ? "warn" : "pass";
}

/** Ask Roz to fix is offered when something is wrong with the script itself, not for a plain block or warning. */
export function shouldOfferFix(result: TestRunResult): boolean {
  return !!result.error || result.contract.length > 0 || result.outcome === "none";
}
