import type { LlmApiStyle } from "./connection";

export interface ModelOption {
  value: string;
  label: string;
}

export const CLAUDE_MODELS: ModelOption[] = [
  { value: "claude-opus-5-5", label: "Opus 5.5" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5" },
  { value: "claude-fable-5-1", label: "Fable 5.1" },
];

const FAMILIES = ["opus", "sonnet", "haiku", "fable"];
const DEFAULT_MODEL = "claude-sonnet-5-5";

interface ParsedModel {
  family: string;
  major: number;
  minor: number;
  /** What follows the version, e.g. "vertex" or "v1"; a release date is dropped. */
  variant?: string;
}

function parseClaudeId(id: string): ParsedModel | null {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?=-|$))?(?:-(\d{8})(?=-|$))?(?:-(.+))?$/.exec(id);
  if (!m || !FAMILIES.includes(m[1])) return null;
  return { family: m[1], major: Number(m[2]), minor: m[3] ? Number(m[3]) : 0, variant: m[5] };
}

const VARIANT_LABELS: Record<string, string> = { vertex: "Vertex", bedrock: "Bedrock" };

/** "claude-opus-4-6-vertex" → "Opus 4.6 (Vertex)"; ids it can't read are shown as they are. */
export function modelLabel(id: string): string {
  const known = CLAUDE_MODELS.find((m) => m.value === id);
  if (known) return known.label;
  const p = parseClaudeId(id);
  if (!p) return id;
  const name = `${p.family[0].toUpperCase()}${p.family.slice(1)} ${p.major}${p.minor ? `.${p.minor}` : ""}`;
  return p.variant ? `${name} (${VARIANT_LABELS[p.variant] ?? p.variant})` : name;
}

/** Alphabetical by label, numbers compared as numbers ("Opus 4.6" before "Opus 4.10"). */
function byLabel(options: ModelOption[]): ModelOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
}

/** The Claude models to offer, alphabetically: every one the endpoint lists, or the named ones when it lists none. */
export function modelOptions(available?: string[]): ModelOption[] {
  const ids = [...new Set((available ?? []).filter((id) => id.startsWith("claude-")))];
  if (!ids.length) return byLabel(CLAUDE_MODELS);
  const options = ids.map((id) => ({ value: id, label: modelLabel(id) }));
  // Two ids that read the same (e.g. a dated and an undated release) show their ids.
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  return byLabel(options.map((o) => (counts.get(o.label)! > 1 ? { ...o, label: `${o.label} — ${o.value}` } : o)));
}

/**
 * The models to offer for a connection, alphabetically. Claude connections get the Claude
 * models the endpoint lists (plus the connection's own model if it isn't one of them);
 * OpenAI-style connections get the connection's model and whatever the endpoint lists, by id.
 */
export function modelOptionsFor(
  style: LlmApiStyle | undefined,
  available?: string[],
  connectionModel?: string
): ModelOption[] {
  if (style === "openai") {
    const ids = [...new Set([connectionModel, ...(available ?? [])].filter((id): id is string => !!id))];
    return byLabel(ids.map((id) => ({ value: id, label: id })));
  }
  const options = modelOptions(available);
  if (connectionModel && !options.some((o) => o.value === connectionModel)) {
    return byLabel([{ value: connectionModel, label: modelLabel(connectionModel) }, ...options]);
  }
  return options;
}

/** `preferred` if it's offered, else Sonnet 5.5 if it is, else the first option ("" when there are none). */
export function pickModel(preferred: string | undefined, options: ModelOption[]): string {
  for (const id of [preferred, DEFAULT_MODEL]) {
    if (id && options.some((o) => o.value === id)) return id;
  }
  return options[0]?.value ?? "";
}
