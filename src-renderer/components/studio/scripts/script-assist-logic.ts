// Pure helpers for the Ask Roz panel: reading a reply, diff stats, prompts, the request history.

export type ScriptType = "Validation" | "Checklist" | "VisitActionValidation";

export interface AssistScript {
  name: string;
  type: ScriptType;
  objectName: string | null;
  operationEventType: string | null;
  code: string;
}

/** Structural subset of the editor's ScriptDiagnostic that the panel reads. */
export interface AssistDiagnostic {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
}

/** Structural subset of the runner's ScriptTestResult that the panel reads. */
export interface AssistTest {
  ok: boolean;
  outcome?: string;
  error?: { message: string; line?: number };
  contract?: string[];
}

export interface AssistToolActivity {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail: string;
}

export interface AssistMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "done" | "error";
  error?: string;
  tools: AssistToolActivity[];
  /** The proposal in this reply has been handed to the editor. */
  proposed?: boolean;
}

export interface AssistRequestMessage {
  role: "user" | "assistant";
  content: string;
}

// --- Reading a reply --------------------------------------------------------------------------

const FENCE = /```[ \t]*(?:javascript|js)[ \t]*\r?\n([\s\S]*?)```/i;
const OPEN_FENCE = /```[ \t]*(?:javascript|js)[ \t]*\r?\n[\s\S]*$/i;

export type ReplySegment = { kind: "prose"; text: string } | { kind: "code"; code: string } | { kind: "writing" };

/**
 * A reply as prose and the proposed script. The first complete javascript block becomes the proposal
 * (a later one stays as ordinary text); a block still being written is a "writing" placeholder so the
 * panel never dumps half a script while it streams.
 */
export function splitReply(text: string): ReplySegment[] {
  const out: ReplySegment[] = [];
  const done = FENCE.exec(text);
  if (done) {
    pushProse(out, text.slice(0, done.index));
    out.push({ kind: "code", code: done[1].replace(/\s+$/, "") });
    pushProse(out, text.slice(done.index + done[0].length));
    return out;
  }
  const open = OPEN_FENCE.exec(text);
  if (open) {
    pushProse(out, text.slice(0, open.index));
    out.push({ kind: "writing" });
    return out;
  }
  pushProse(out, text);
  return out;
}

function pushProse(out: ReplySegment[], text: string): void {
  if (text.trim()) out.push({ kind: "prose", text: text.trim() });
}

/** The complete script in a reply, or null. */
export function extractCode(text: string): string | null {
  const seg = splitReply(text).find((s) => s.kind === "code");
  return seg && seg.kind === "code" && seg.code.trim() ? seg.code : null;
}

/** The reply without its script: what the editor shows as the proposal's summary. */
export function replySummary(text: string): string {
  return splitReply(text)
    .filter((s): s is { kind: "prose"; text: string } => s.kind === "prose")
    .map((s) => s.text)
    .join("\n\n");
}

/** The summary as one line for the proposal header: its first line without a list marker or Markdown emphasis. */
export function summaryLine(summary: string): string {
  const first = summary.split("\n").find((l) => l.trim()) ?? "";
  return first.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/(\*\*|__|`)/g, "").trim();
}

// --- Diff stats -------------------------------------------------------------------------------

export interface DiffStats {
  added: number;
  removed: number;
}

/** Lines added and removed going from `before` to `after` (a longest-common-subsequence line diff). */
export function diffStats(before: string, after: string): DiffStats {
  const a = before.trim() ? before.replace(/\s+$/, "").split("\n") : [];
  const b = after.trim() ? after.replace(/\s+$/, "").split("\n") : [];
  // Trim the shared head and tail so the table covers only what changed.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length * y.length > 4_000_000) return { added: y.length, removed: x.length };
  const prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const up = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = up;
    }
  }
  const common = prev[y.length];
  return { added: y.length - common, removed: x.length - common };
}

/** "+12 −3 lines", "+4 lines", "No changes". */
export function describeDiff({ added, removed }: DiffStats): string {
  if (!added && !removed) return "No changes";
  const parts = [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean);
  return `${parts.join(" ")} ${added + removed === 1 ? "line" : "lines"}`;
}

// --- Prompts ----------------------------------------------------------------------------------

/** Three or four things worth asking for, tailored to the script's type and object. */
export function starterPrompts(type: ScriptType, objectName: string | null): string[] {
  if (type === "VisitActionValidation") {
    return [
      "Block Submit when a sampling visit has no samples",
      "Warn when a detailed product has no key message",
      "Require a signature for controlled substances",
      "Explain what this script checks today",
    ];
  }
  if (type === "Checklist") {
    const on = objectName ?? "the record";
    return [
      `Show a checklist of what's missing on ${on} before it moves on`,
      "Warn when the account has no recent visit",
      "Mark each required field as done or missing",
      "Explain what this script checks today",
    ];
  }
  const on = objectName ?? "the record";
  return [
    `Block the action when a required field on ${on} is empty`,
    "Warn when the account has no active territory",
    "Stop approval unless a related record exists",
    "Explain what this script checks today",
  ];
}

export function problemCount(diagnostics: AssistDiagnostic[] | undefined): number {
  return (diagnostics ?? []).filter((d) => d.severity === "error" || d.severity === "warning").length;
}

export function testFailed(test: AssistTest | undefined): boolean {
  return !!test && (!test.ok || !!test.error);
}

export function fixProblemsPrompt(count: number): string {
  return count === 1 ? "Fix the problem the editor found in this script." : `Fix the ${count} problems the editor found in this script.`;
}

export const FIX_TEST_PROMPT = "The last test failed. Find out why and fix the script.";

// --- The request ------------------------------------------------------------------------------

const OMITTED = "(proposed script omitted; the current code is in the editor)";

/**
 * The conversation as the model should see it: finished replies only, older scripts replaced by a
 * note (the editor's current code travels in the system prompt), same-role neighbours merged.
 */
export function requestMessages(messages: AssistMessage[]): AssistRequestMessage[] {
  const out: AssistRequestMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.status !== "done") continue;
    const content =
      m.role === "assistant"
        ? splitReply(m.text)
            .map((s) => (s.kind === "prose" ? s.text : s.kind === "code" ? OMITTED : ""))
            .filter(Boolean)
            .join("\n\n")
        : m.text;
    if (!content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  return out;
}

export interface AssistRequest {
  messages: AssistRequestMessage[];
  script: AssistScript;
  diagnostics?: AssistDiagnostic[];
  lastTest?: AssistTest;
}

/** What the conversation can retry: the last user message when the reply after it failed. */
export function canRetry(messages: AssistMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.role === "assistant" && last.status === "error";
}

/** Whether `text` should send: Enter alone, or ⌘/Ctrl+Enter; never mid-composition or with Shift. */
export function isSendKey(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean }): boolean {
  if (e.key !== "Enter" || e.isComposing) return false;
  if (e.metaKey || e.ctrlKey) return true;
  return !e.shiftKey;
}
