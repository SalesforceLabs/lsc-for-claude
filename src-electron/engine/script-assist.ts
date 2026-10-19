import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ContentBlock, LLMProvider, Message, StreamChunk, ToolDefinition } from "../llm/provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Rounds of tool calls before Ask Roz must answer. */
export const MAX_ASSIST_ROUNDS = 6;
/** Largest LIMIT a model-issued query may use. */
export const MAX_ASSIST_SOQL_LIMIT = 50;
/** A tool result longer than this is cut before it goes back to the model. */
const MAX_TOOL_RESULT_CHARS = 14_000;

export type AssistScriptType = "Validation" | "Checklist" | "VisitActionValidation";

export interface AssistDiagnostic {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  from?: number;
  to?: number;
}

export interface AssistTestResult {
  ok: boolean;
  outcome?: string;
  results?: { title: string; status: string }[];
  logs?: { level: string; text: string }[];
  queries?: { object: string; soql: string; rows: number; error?: string }[];
  error?: { message: string; line?: number; column?: number };
  contract?: string[];
  notes?: string[];
}

export interface ScriptAssistRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  script: {
    name: string;
    type: AssistScriptType;
    objectName: string | null;
    operationEventType: string | null;
    code: string;
  };
  diagnostics?: AssistDiagnostic[];
  lastTest?: AssistTestResult;
  model?: string;
}

/** What Ask Roz needs from the app: the org's tools, nothing else. */
export interface ScriptAssistHost {
  callTool(name: string, args: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<{ text: string; isError: boolean }>;
}

export interface ScriptAssistOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** A tool the model is using: "running" when it starts, then "done" or "error". */
  onTool?: (name: string, status: "running" | "done" | "error", detail?: string) => void;
  model?: string;
}

// --- Tools ---------------------------------------------------------------------------------

export const ASSIST_TOOLS: ToolDefinition[] = [
  {
    name: "describe_sobject",
    description:
      "Describe a Salesforce object in the connected org: its real field API names, types and which are custom. Use before referencing any field of an object you haven't confirmed.",
    input_schema: {
      type: "object",
      properties: { objectName: { type: "string", description: "API name, e.g. ProviderVisit" } },
      required: ["objectName"],
    },
  },
  {
    name: "run_soql",
    description: `Run a read-only SOQL SELECT against the connected org to look at real data. A LIMIT of ${MAX_ASSIST_SOQL_LIMIT} or less is required (one is added when missing).`,
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A single SELECT statement" } },
      required: ["query"],
    },
  },
];

/** `soql` ready to run (a LIMIT added when missing), or why it was refused. */
export function guardSoql(soql: unknown): { ok: true; query: string } | { ok: false; error: string } {
  if (typeof soql !== "string" || !soql.trim()) return { ok: false, error: "Give a SOQL SELECT statement." };
  let query = soql.trim().replace(/;+\s*$/, "");
  if (!/^select\s/i.test(query)) return { ok: false, error: "Only SELECT queries are allowed." };
  if (query.includes(";")) return { ok: false, error: "Run one statement at a time." };
  if (/\bfor\s+(update|view|reference)\b/i.test(query)) return { ok: false, error: "FOR UPDATE / VIEW / REFERENCE isn't allowed." };
  const limit = /\blimit\s+(\d+)\s*(offset\s+\d+\s*)?$/i.exec(query);
  if (limit) {
    if (Number(limit[1]) > MAX_ASSIST_SOQL_LIMIT) return { ok: false, error: `LIMIT must be ${MAX_ASSIST_SOQL_LIMIT} or less.` };
  } else if (/\blimit\b/i.test(query)) {
    return { ok: false, error: `Put a numeric LIMIT of ${MAX_ASSIST_SOQL_LIMIT} or less at the end.` };
  } else {
    query += ` LIMIT ${MAX_ASSIST_SOQL_LIMIT}`;
  }
  return { ok: true, query };
}

/** A short line for the panel's quiet tool activity. */
export function describeToolUse(name: string, input: Record<string, unknown>): string {
  if (name === "describe_sobject") return `Looking up ${String(input.objectName ?? "an object")} fields…`;
  if (name === "run_soql") return "Checking a few records…";
  return "Working…";
}

/** The tool call as it will be sent to the org, or why it was refused. */
export function prepareToolCall(
  name: string,
  input: Record<string, unknown>
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (name === "describe_sobject") {
    const objectName = typeof input.objectName === "string" ? input.objectName.trim() : "";
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectName)) return { ok: false, error: "Give the object's API name." };
    return { ok: true, args: { objectName } };
  }
  if (name === "run_soql") {
    const guarded = guardSoql(input.query);
    return guarded.ok ? { ok: true, args: { query: guarded.query } } : guarded;
  }
  return { ok: false, error: `${name} isn't available here.` };
}

// --- Knowledge -----------------------------------------------------------------------------

function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

/** The `## ` sections of a markdown file whose heading starts with one of `headings` (after the "## "), joined. */
export function extractSections(markdown: string, headings: string[]): string {
  const out: string[] = [];
  let keep = false;
  for (const line of markdown.split("\n")) {
    if (/^## /.test(line)) keep = headings.some((h) => line.slice(3).startsWith(h));
    if (keep) out.push(line);
  }
  return out.join("\n").trim();
}

let knowledgeCache: string | null = null;

/** The API reference and the skill's practical sections, read once. */
export function loadAssistKnowledge(root: string = projectRoot()): string {
  const isDefault = root === projectRoot();
  if (isDefault && knowledgeCache) return knowledgeCache;
  const read = (rel: string): string => {
    try {
      return fs.readFileSync(path.join(root, rel), "utf-8");
    } catch {
      return "";
    }
  };
  const reference = extractSections(read("knowledge/modules/custom-scripts/custom-scripts-api-reference.md"), [
    "2. Script format",
    "3. Global variables",
    "4. Classes",
    "5. Functions",
    "6. Best practices",
    "10. Verified in an org",
  ]);
  const skill = extractSections(read("skills/lsc-custom-scripts/SKILL.md"), [
    "Two Runtimes",
    "Confirmed Working IIFE Pattern",
    "Context Data Structure",
    "Available Globals",
    "Available Classes",
    "Output Format",
    "Critical Gotchas",
  ]);
  const text = [
    reference && `# API reference\n\n${reference}`,
    skill && `# Practical patterns and gotchas (confirmed in orgs)\n\n${skill}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (isDefault) knowledgeCache = text;
  return text;
}

// --- Prompt --------------------------------------------------------------------------------

const TYPE_CONTRACT: Record<AssistScriptType, string> = {
  VisitActionValidation:
    "Visit action validation: runs when a rep saves, signs or submits a visit (not Withdraw), on web and on the iPad, offline. It must return an array of { title, status } with status \"success\", \"warning\" or \"error\". An error blocks the action; warnings only ask the rep to continue; success is not shown. Only one such script runs per org. The object is ProviderVisit and the event OnUpdate. `env.getOption('actionName')` is Save, Submit or Sign. The script must work on both runtimes (web awaits promises; on the iPad await is stripped and db calls are synchronous).",
  Validation:
    "Workflow validation: runs when a user runs a workflow action on a stage object's record. Return an array of { title, status }. An error blocks the action, warnings ask to continue, success is not shown. `env.getOption('actionName')` is the action's label.",
  Checklist:
    "Checklist: runs when the user taps the info icon on a Record Update action. Return an array of { title, status } and every status is displayed (success as a green check, warning, error). It does not block anything.",
};

const HARD_RULES = `Hard rules for every script you write:
- The file is exactly one IIFE: \`(() => { ... })();\`. Nothing before it, not even a comment. Comments go inside.
- Return an array of { title, status } objects, status being "success", "warning" or "error". Return plain data: call unwrapProxy(results) (JSON.parse(JSON.stringify(results))) before returning, on every return path.
- await every db call that is async on web (the platform strips await on the iPad). Never leave a promise unresolved.
- Customer custom fields (__c) are read with the noNs_ accessors (noNs_stringValue etc.) or the documented helper pattern, never plain stringValue; use describe_sobject to learn which fields are custom and their exact API names.
- No browser APIs (window, document, fetch, localStorage, alert, setTimeout), no OmniStudio, no imports or require. console.* and env.log are fine for diagnostics.
- Guard globals (env, db, record, user, contextData) before use, as the confirmed VAV pattern does, so the script cannot throw when one is missing.
- Use only the APIs documented below. Never invent a method, class, field or object name. If you are not sure something exists, say so and ask or choose the documented way.
- Keep the script small and readable; titles should be plain sentences a rep understands ("Add at least one sample before submitting").`;

const RESPONSE_FORMAT = `How to answer:
- First a short plain-language explanation of what you changed or the answer (bullets are fine, at most 120 words unless the user asks for more). No preamble, no restating the request.
- Then, only if you are proposing code, exactly one \`\`\`javascript block containing the COMPLETE script (never a fragment or a diff). Do not include the block when the user only asked a question or you need more information.
- Do not write text before using a tool; use tools quietly and answer after.
- Prefer writing the script over asking questions. When the request is ambiguous, pick the most reasonable reading, say the assumption in one line, and write it. Ask first only when you cannot write anything useful without the answer.
- Look things up sparingly: a describe of the objects you will read, and at most a couple of queries.`;

export function buildAssistSystemPrompt(request: ScriptAssistRequest, knowledge: string = loadAssistKnowledge()): string {
  const { script } = request;
  const parts: string[] = [
    "You are Roz, helping a Life Sciences Cloud admin write and fix a custom script (LifeScienceCustomScript) inside Studio. You write JavaScript that the LSC web and iPad apps run.",
    `# This script's type\n\n${TYPE_CONTRACT[script.type] ?? ""}`,
    HARD_RULES,
    RESPONSE_FORMAT,
    knowledge,
    [
      "# The script being edited",
      `Name: ${script.name || "(unnamed)"}`,
      `Type: ${script.type}`,
      `Object: ${script.objectName ?? "(none)"}`,
      `Event: ${script.operationEventType ?? "(none)"}`,
      "Current code (this is what is in the editor right now; base your answer on it):",
      "```javascript\n" + (script.code.trim() || "// (empty)") + "\n```",
    ].join("\n"),
  ];

  if (request.diagnostics?.length) {
    parts.push(
      "# Problems the editor currently reports\n" +
        request.diagnostics
          .slice(0, 20)
          .map((d) => `- [${d.severity}] ${d.id}: ${d.message}${d.detail ? ` (${d.detail})` : ""}`)
          .join("\n")
    );
  }
  if (request.lastTest) parts.push(`# The last test run\n${describeTest(request.lastTest)}`);
  return parts.join("\n\n");
}

function describeTest(t: AssistTestResult): string {
  const lines = [`Ran ${t.ok ? "to completion" : "but failed"}${t.outcome ? `; outcome: ${t.outcome}` : ""}.`];
  if (t.error) lines.push(`Error: ${t.error.message}${t.error.line ? ` (line ${t.error.line})` : ""}`);
  for (const c of t.contract ?? []) lines.push(`Contract problem: ${c}`);
  for (const r of (t.results ?? []).slice(0, 10)) lines.push(`Result: [${r.status}] ${r.title}`);
  for (const q of (t.queries ?? []).slice(0, 10)) lines.push(`Query on ${q.object}: ${q.soql} -> ${q.error ? `error ${q.error}` : `${q.rows} rows`}`);
  for (const l of (t.logs ?? []).slice(0, 10)) lines.push(`Log (${l.level}): ${l.text}`);
  for (const n of t.notes ?? []) lines.push(`Note: ${n}`);
  return lines.join("\n");
}

// --- Run -----------------------------------------------------------------------------------

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
}

/**
 * One Ask Roz turn: stream the model's answer, running up to MAX_ASSIST_ROUNDS rounds of
 * read-only org lookups, and return the whole text (prose plus the proposed script).
 * Throws "aborted" when `signal` fires.
 */
export async function runScriptAssist(
  llm: LLMProvider,
  host: ScriptAssistHost,
  request: ScriptAssistRequest,
  options: ScriptAssistOptions = {}
): Promise<string> {
  const { signal, onDelta, onTool } = options;
  const model = options.model ?? request.model;
  const system = buildAssistSystemPrompt(request);
  const messages: Message[] = request.messages.map((m) => ({ role: m.role, content: m.content }));
  const texts: string[] = [];
  const checkAbort = () => {
    if (signal?.aborted) throw new Error("aborted");
  };

  for (let round = 0; round < MAX_ASSIST_ROUNDS; round++) {
    checkAbort();
    let roundText = "";
    let response: Message;
    try {
      response = await llm.chat(system, messages, ASSIST_TOOLS, { model, signal, maxTokens: 16_000 }, (chunk: StreamChunk) => {
        if (signal?.aborted) return;
        if (chunk.type === "text_delta" && chunk.text) {
          // Text after a tool round starts a new paragraph.
          if (!roundText && texts.length) onDelta?.("\n\n");
          roundText += chunk.text;
          onDelta?.(chunk.text);
        }
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("aborted");
      throw error;
    }
    checkAbort();
    if (roundText) texts.push(roundText);
    messages.push(response);

    const calls = (Array.isArray(response.content) ? response.content : []).filter((b: ContentBlock) => b.type === "tool_use");
    if (calls.length === 0) return texts.join("\n\n") || textOf(response);

    const results: ContentBlock[] = [];
    for (const call of calls) {
      checkAbort();
      const input = (call.input ?? {}) as Record<string, unknown>;
      const prepared = prepareToolCall(call.name!, input);
      const detail = describeToolUse(call.name!, input);
      if (!prepared.ok) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: `Error: ${prepared.error}`, is_error: true });
        onTool?.(call.name!, "error", prepared.error);
        continue;
      }
      onTool?.(call.name!, "running", detail);
      try {
        const out = await host.callTool(call.name!, prepared.args, { timeoutMs: 30_000 });
        let content = out.text;
        if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "\n…(cut)";
        results.push({ type: "tool_result", tool_use_id: call.id, content, is_error: out.isError });
        onTool?.(call.name!, out.isError ? "error" : "done", detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ type: "tool_result", tool_use_id: call.id, content: `Error: ${message}`, is_error: true });
        onTool?.(call.name!, "error", message);
      }
    }
    messages.push({ role: "user", content: results });
  }

  // Out of rounds: ask for the answer with what it has.
  checkAbort();
  messages.push({ role: "user", content: "Answer now with what you have, without using tools." });
  const final = await llm.chat(system, messages, [], { model, signal, maxTokens: 16_000 }, (chunk) => {
    if (chunk.type === "text_delta" && chunk.text && !signal?.aborted) onDelta?.(chunk.text);
  });
  texts.push(textOf(final));
  return texts.join("\n\n");
}
