/**
 * Asks the chat model which known causes could explain a problem message, choosing from the
 * list of cause titles, so `diagnose_lsc_issue` also checks causes whose stored symptoms share
 * no words with how the user put it. Word matching stays the first pass; these picks are only
 * offered as possible causes and checked against the org like any other.
 *
 * The main process doesn't import server code, so it reads the causes file itself (ids, areas
 * and titles only). Any failure — no file, a slow or refused request, a reply with no picks —
 * gives no picks, and diagnose runs on word matching alone.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { LLMProvider, Message, ToolDefinition } from "../llm/provider.js";

export interface CauseTitle {
  id: string;
  module: string;
  title: string;
}

/** How long the picker may hold up the first diagnosis. */
export const PICK_TIMEOUT_MS = 8_000;
export const MAX_PICKS = 3;
const MAX_MESSAGE_CHARS = 2_000;
/**
 * Room for the reply. At 200 tokens the tool call was often cut off before it ended, and a
 * call that doesn't end carries no ids.
 */
export const PICK_MAX_TOKENS = 1_024;

// The app's main process is an ES module: there is no __dirname.
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAUSES_FILE = path.join("knowledge", "troubleshooting", "known-causes.yaml");

let cached: { file: string; titles: CauseTitle[] } | null = null;

/** Ids, areas and titles of the known causes; empty when the file can't be read. */
export function loadCauseTitles(projectDir = PROJECT_DIR): CauseTitle[] {
  const file = path.join(projectDir, CAUSES_FILE);
  if (cached?.file === file) return cached.titles;
  let titles: CauseTitle[] = [];
  try {
    const parsed = parseYaml(fs.readFileSync(file, "utf-8")) as { causes?: unknown[] };
    titles = (parsed.causes ?? []).flatMap((c) => {
      const { id, module, title } = (c ?? {}) as Record<string, unknown>;
      return typeof id === "string" && typeof title === "string"
        ? [{ id, module: typeof module === "string" ? module : "", title }]
        : [];
    });
  } catch {
    titles = [];
  }
  cached = { file, titles };
  return titles;
}

/**
 * The tool the model answers with, so the answer has a fixed shape: asked for JSON in text, it
 * sometimes explained its choice in prose instead, or replied with nothing. The call isn't
 * forced (`tool_choice`): some gateways refuse a forced tool for some models.
 */
export const PICK_TOOL = "report_causes";
export const PICK_TOOL_DEF: ToolDefinition = {
  name: PICK_TOOL,
  description:
    "Report the known cause ids that could explain the problem, best first, each with how well it fits.",
  input_schema: {
    type: "object",
    properties: {
      causes: {
        type: "array",
        maxItems: MAX_PICKS,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            fit: { type: "string", enum: ["explains", "related"] },
          },
          required: ["id", "fit"],
        },
      },
    },
    required: ["causes"],
  },
};

export function pickerPrompt(titles: CauseTitle[]): string {
  const list = titles.map((c) => `${c.id} [${c.module}]: ${c.title}`).join("\n");
  return `You match a Life Sciences Cloud (LSC) admin's problem description to known configuration causes.
Known causes (id [module]: title):
${list}

Call ${PICK_TOOL} with up to ${MAX_PICKS} causes, best first, that could explain the problem, each with a fit:
- "explains": the setting this cause names would produce what the user describes, as they describe it.
- "related": the cause is in the same area, or about the same object or screen, but doesn't by itself produce what they describe.
The list covers only some problems, so many messages describe one it doesn't cover; then every cause you pick is "related". If the message is a question, a request or an opinion, or no cause is even related, call it with an empty list.`;
}

/** A picked cause: `explains` when it would produce what the user describes, `related` when it's only nearby. */
export interface CausePick {
  id: string;
  fit: "explains" | "related";
}

/**
 * The known causes in a reply, best first, at most `MAX_PICKS`; none when it isn't the JSON asked
 * for. A pick with no fit (an older shape, `{"ids":[…]}`) counts as `related`.
 */
export function parsePicks(reply: string, known: Set<string>): CausePick[] {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  let parsed: { causes?: unknown; ids?: unknown };
  try {
    parsed = JSON.parse(json) as { causes?: unknown; ids?: unknown };
  } catch {
    return [];
  }
  const raw: unknown[] = Array.isArray(parsed.causes)
    ? parsed.causes
    : Array.isArray(parsed.ids)
      ? parsed.ids
      : [];
  const picks: CausePick[] = [];
  for (const entry of raw) {
    const { id, fit } =
      typeof entry === "string"
        ? { id: entry, fit: undefined }
        : ((entry ?? {}) as { id?: unknown; fit?: unknown });
    if (typeof id !== "string" || !known.has(id) || picks.some((p) => p.id === id)) continue;
    picks.push({ id, fit: fit === "explains" ? "explains" : "related" });
  }
  return picks.slice(0, MAX_PICKS);
}

/** The picks in a reply: the tool call's, else JSON in its text (a model that answered in text instead). */
export function picksFrom(reply: Message, known: Set<string>): CausePick[] {
  if (typeof reply.content === "string") return parsePicks(reply.content, known);
  const call = reply.content.find((b) => b.type === "tool_use" && b.name === PICK_TOOL);
  if (call) return parsePicks(JSON.stringify(call.input ?? {}), known);
  return parsePicks(
    reply.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join(""),
    known
  );
}

/** The causes the model picks for `text`, with their fit; [] on any failure. */
export async function pickCauses(
  llm: LLMProvider,
  text: string,
  options: { model?: string; titles?: CauseTitle[]; timeoutMs?: number } = {}
): Promise<CausePick[]> {
  const titles = options.titles ?? loadCauseTitles();
  if (!titles.length || !text.trim()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PICK_TIMEOUT_MS);
  try {
    const reply = await llm.chat(
      pickerPrompt(titles),
      [{ role: "user", content: text.trim().slice(0, MAX_MESSAGE_CHARS) }],
      [PICK_TOOL_DEF],
      {
        model: options.model,
        maxTokens: PICK_MAX_TOKENS,
        cache: true,
        signal: controller.signal,
      }
    );
    return picksFrom(reply, new Set(titles.map((t) => t.id)));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
