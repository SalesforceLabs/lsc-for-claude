/**
 * Asks the chat model which known causes could explain a problem message, choosing from the
 * list of cause titles, so `diagnose_lsc_issue` also checks causes whose stored symptoms share
 * no words with how the user put it. Word matching stays the first pass; these picks are only
 * offered as possible causes and checked against the org like any other.
 *
 * The main process doesn't import server code, so it reads the causes file itself (ids, areas
 * and titles only). Any failure — no file, a slow or refused request, a reply that isn't JSON —
 * gives no picks, and diagnose runs on word matching alone.
 */

import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { LLMProvider } from "../llm/provider.js";

export interface CauseTitle {
  id: string;
  module: string;
  title: string;
}

/** How long the picker may hold up the first diagnosis. */
export const PICK_TIMEOUT_MS = 8_000;
export const MAX_PICKS = 3;
const MAX_MESSAGE_CHARS = 2_000;

const CAUSES_FILE = path.join("knowledge", "troubleshooting", "known-causes.yaml");

let cached: { file: string; titles: CauseTitle[] } | null = null;

/** Ids, areas and titles of the known causes; empty when the file can't be read. */
export function loadCauseTitles(projectDir = path.resolve(__dirname, "..", "..")): CauseTitle[] {
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

export function pickerPrompt(titles: CauseTitle[]): string {
  const list = titles.map((c) => `${c.id} [${c.module}]: ${c.title}`).join("\n");
  return `You match a Life Sciences Cloud (LSC) admin's problem description to known configuration causes.
Known causes (id [module]: title):
${list}

Reply with JSON only: {"ids": [...]} — up to ${MAX_PICKS} cause ids, best first, that could explain the problem.
Pick a cause only if it plausibly explains what the user describes. If the message is a how-to question, a request, or no listed cause fits, reply {"ids": []}.`;
}

/** The known ids in a reply, best first, at most `MAX_PICKS`; none when it isn't the JSON asked for. */
export function parsePicks(reply: string, known: Set<string>): string[] {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  try {
    const ids = (JSON.parse(json) as { ids?: unknown }).ids;
    if (!Array.isArray(ids)) return [];
    const picks = ids.filter((i): i is string => typeof i === "string" && known.has(i));
    return [...new Set(picks)].slice(0, MAX_PICKS);
  } catch {
    return [];
  }
}

/** Cause ids the model picks for `text`; [] on any failure. */
export async function pickCauses(
  llm: LLMProvider,
  text: string,
  options: { model?: string; titles?: CauseTitle[]; timeoutMs?: number } = {}
): Promise<string[]> {
  const titles = options.titles ?? loadCauseTitles();
  if (!titles.length || !text.trim()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PICK_TIMEOUT_MS);
  try {
    const reply = await llm.chat(
      pickerPrompt(titles),
      [{ role: "user", content: text.trim().slice(0, MAX_MESSAGE_CHARS) }],
      [],
      { model: options.model, maxTokens: 100, cache: true, signal: controller.signal }
    );
    const content =
      typeof reply.content === "string"
        ? reply.content
        : reply.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
    return parsePicks(content, new Set(titles.map((t) => t.id)));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
