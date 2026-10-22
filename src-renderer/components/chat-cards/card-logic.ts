/**
 * Which tool results chat shows as a card, and what each card is made of. Pure: a tool call
 * (name, status, result text) in, a card description or null out.
 */

import type { ToolCall } from "../../hooks/useChat";
import { bareName } from "../../chat-activity";
import type { DiagnosisItem, DiagnosisResult } from "../studio/diagnose-logic";
import type { UserTrace } from "../studio/user-trace-state";
import type { ReadinessCheck } from "../studio/types";

export interface UserMatch {
  id: string;
  name: string;
  username: string;
  profile?: string;
}

/** `check_user_access`'s result: `studio_user_trace` plus who the name resolved to. */
export type UserCheckTrace = UserTrace & { resolvedUser?: { id: string; name: string; username: string } };

export type ChatCard =
  | { kind: "diagnosis"; result: DiagnosisResult }
  | { kind: "user-check"; trace: UserCheckTrace }
  | { kind: "user-matches"; matches: UserMatch[]; message?: string }
  | { kind: "queued"; labels: string[]; message?: string }
  | { kind: "loading"; title: string }
  | { kind: "failed"; title: string; message: string };

type CardTool = Pick<ToolCall, "name" | "status" | "result">;

const DIAGNOSE = "diagnose_lsc_issue";
const USER_CHECK = "check_user_access";

function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text.trim());
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function isItem(value: unknown): value is DiagnosisItem {
  const v = value as Partial<DiagnosisItem> | null;
  return !!v && typeof v === "object" && typeof v.id === "string" && typeof v.title === "string" && typeof v.status === "string";
}

/** The diagnosis in `diagnose_lsc_issue`'s JSON, or null when the result is prose (the tool's default format). */
export function parseDiagnosis(text: string | undefined): DiagnosisResult | null {
  const data = parseObject(text);
  if (!data || !Array.isArray(data.items)) return null;
  const items = data.items.filter(isItem).map((i) => ({
    ...i,
    records: strings(i.records),
    steps: strings(i.steps),
    failedRules: (Array.isArray(i.failedRules) ? i.failedRules : []).flatMap((r) => {
      const v = r as Partial<DiagnosisItem["failedRules"][number]> | null;
      return v && typeof v === "object" ? [{ id: String(v.id ?? ""), name: String(v.name ?? "A rule"), message: String(v.message ?? "") }] : [];
    }),
  }));
  return {
    items,
    checkedOrg: typeof data.checkedOrg === "string" ? data.checkedOrg : null,
    orgNote: typeof data.orgNote === "string" ? data.orgNote : undefined,
  };
}

function isCheck(value: unknown): value is ReadinessCheck {
  const v = value as Partial<ReadinessCheck> | null;
  return !!v && typeof v === "object" && typeof v.id === "string" && typeof v.stage === "string" && typeof v.title === "string" && typeof v.status === "string";
}

/** `check_user_access`'s trace, keeping only well-formed checks (saved results from older versions may differ); null when none are left. */
export function parseUserTrace(data: Record<string, unknown>): UserCheckTrace | null {
  if (!Array.isArray(data.checks) || typeof data.userId !== "string") return null;
  const checks = data.checks.filter(isCheck).map((c) => ({ ...c, fixes: Array.isArray(c.fixes) ? c.fixes.filter((f) => !!f && typeof f === "object") : undefined }));
  if (checks.length === 0) return null;
  return {
    ...(data as unknown as UserCheckTrace),
    userName: typeof data.userName === "string" ? data.userName : "This user",
    profile: typeof data.profile === "string" ? data.profile : null,
    featureId: typeof data.featureId === "string" ? data.featureId : null,
    checks,
  };
}

/** The checks with their "create a record" fixes taken out, or the same array when none had one. */
export function withoutCreateFixes(checks: ReadinessCheck[]): ReadinessCheck[] {
  if (!checks.some((c) => c.fixes?.some((f) => f.kind === "createConfigRecord"))) return checks;
  return checks.map((c) => (c.fixes?.some((f) => f.kind === "createConfigRecord") ? { ...c, fixes: c.fixes.filter((f) => f.kind !== "createConfigRecord") } : c));
}

function parseMatches(value: unknown): UserMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((m) => {
    const v = m as Partial<UserMatch> | null;
    return v && typeof v.id === "string" && typeof v.name === "string"
      ? [{ id: v.id, name: v.name, username: typeof v.username === "string" ? v.username : "", profile: typeof v.profile === "string" ? v.profile : undefined }]
      : [];
  });
}

/** A tool result `{"status":"queued","changes":["label",…]}`: a write that went to the Studio tray. */
export function parseQueued(text: string | undefined): { labels: string[]; message?: string } | null {
  const data = parseObject(text);
  if (!data || data.status !== "queued") return null;
  const labels = Array.isArray(data.changes) ? data.changes.filter((c): c is string => typeof c === "string") : [];
  return { labels, message: typeof data.message === "string" ? data.message : undefined };
}

/** What the model's tool reported when it failed, trimmed to one readable paragraph. */
function failureMessage(result: string | undefined): string {
  const data = parseObject(result);
  const text = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : (result ?? "");
  const clean = text.replace(/^error:\s*/i, "").trim();
  return clean.length > 400 ? `${clean.slice(0, 399)}…` : clean || "The check didn't finish.";
}

const RUNNING = (status: ToolCall["status"]) => status === "pending" || status === "running";

/** The card for a tool call, or null when it stays an ordinary step row. */
export function cardFor(tool: CardTool): ChatCard | null {
  const name = bareName(tool.name);
  if (name === DIAGNOSE || name === USER_CHECK) {
    const diagnose = name === DIAGNOSE;
    if (RUNNING(tool.status)) return { kind: "loading", title: diagnose ? "Matching known causes…" : "Checking the user…" };
    if (tool.status === "error") return { kind: "failed", title: diagnose ? "Couldn't match known causes" : "Couldn't check the user", message: failureMessage(tool.result) };
    if (diagnose) {
      const result = parseDiagnosis(tool.result);
      return result ? { kind: "diagnosis", result } : null;
    }
    const data = parseObject(tool.result);
    if (!data) return null;
    if (Array.isArray(data.checks) && typeof data.userId === "string") {
      const trace = parseUserTrace(data);
      return trace ? { kind: "user-check", trace } : null;
    }
    if (Array.isArray(data.matches)) {
      return { kind: "user-matches", matches: parseMatches(data.matches), message: typeof data.message === "string" ? data.message : undefined };
    }
    if (typeof data.error === "string") return { kind: "failed", title: "Couldn't check the user", message: failureMessage(tool.result) };
    return null;
  }
  if (tool.status === "success") {
    const queued = parseQueued(tool.result);
    if (queued) return { kind: "queued", ...queued };
  }
  return null;
}

/** Whether the step row above the card should go: only when it would contradict the card ("Matched…" over "No known cause matched"). */
export function cardHidesStep(card: ChatCard | null): boolean {
  return card?.kind === "diagnosis" && card.result.items.length === 0;
}

/** The message that picks one of several matching users: sent as the user's next turn. */
export function pickUserMessage(match: UserMatch): string {
  return `I mean ${match.name}${match.username ? ` (${match.username})` : ""}.`;
}

/** "Waiting in Studio: Activate X, Give Y" — plain text for the queued card. */
export function queuedSummary(labels: string[]): string {
  if (labels.length === 0) return "Waiting in Studio";
  return labels.length <= 3 ? `Waiting in Studio: ${labels.join(", ")}` : `Waiting in Studio: ${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more`;
}

/** "1 change waiting in Studio" / "3 changes waiting in Studio". */
export function trayPillLabel(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"} waiting in Studio`;
}
