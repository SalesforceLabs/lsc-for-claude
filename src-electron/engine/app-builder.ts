import { randomUUID } from "crypto";
import type { ContentBlock, LLMProvider, Message, StreamChunk, ToolDefinition } from "../llm/provider.js";
import type { AppStore } from "./app-store.js";
import type {
  AppBuilderEvent,
  AppCheckResult,
  AppFile,
  AppIssue,
  AppProject,
  AppRunAs,
  AppStarter,
  AppTabSettings,
  AppStep,
  AppTarget,
  AppTurn,
  AppVersion,
  OrgApp,
} from "./app-types.js";

/**
 * The LSC App Builder's agent loop: the user's prompt goes to the connected model with the org's
 * real schema on hand (describe_objects / sample_records), the model writes an `lscMobileInline_*`
 * bundle (write_app), Studio compiles and checks it (studio_app_check), and failures go back to the
 * model to repair. Self-contained on purpose — the chat engine's loop is built around MCP tools and
 * a session, and this one has four tools of its own.
 */

export const NAME_PREFIX = "lscMobileInline_";
export const MAX_ROUNDS = 12;
/** Consecutive write_app rounds that fail (rejected, or checked with errors) before the turn gives up. */
export const MAX_FAILING_WRITES = 4;
const MAX_FILES_PER_WRITE = 40;
const MAX_SOURCE_CHARS = 200_000;
const MAX_TOKENS = 32_000;
const SAVE_DEBOUNCE_MS = 250;

/** Calls a Studio MCP tool on the selected org's server and returns its parsed JSON; throws on an error result. */
export type StudioCall = (tool: string, args: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;

export interface AppBuilderDeps {
  /** The current model connection; read per turn so a reconnect is picked up. */
  llm: () => LLMProvider | null;
  /** Model to use: the connection's default, else the strongest listed (see `pickBuilderModel`). */
  model: () => string | undefined;
  call: StudioCall;
  store: AppStore;
  emit: (projectId: string, event: AppBuilderEvent) => void;
  /** A Studio test user's credentials for data reads (refreshed when stale); throws when the login is gone. Never sent to the renderer. */
  mobileLogin?: (loginId: string) => Promise<Record<string, unknown>>;
}

/** Parse a Studio tool result (`{ content: [{ text }], isError }`) into its JSON; errors become exceptions. */
export function parseStudioResult(result: { content: Array<{ type?: string; text: string }>; isError?: boolean }): unknown {
  const text = result.content.find((c) => c.type === undefined || c.type === "text")?.text ?? "{}";
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    if (result.isError) throw new Error(text);
    throw new Error(`Unreadable answer from Studio: ${text.slice(0, 200)}`);
  }
  if (result.isError) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof message === "string" ? message : text);
  }
  return data;
}

// --- model choice ---

const FAMILY_RANK: Record<string, number> = { fable: 4, opus: 3, sonnet: 2, haiku: 1 };

/** The strongest Claude model in a list (family, then version), or undefined when none is recognisable. */
export function strongestModel(ids: string[] | null | undefined): string | undefined {
  let best: { id: string; family: number; version: number } | undefined;
  for (const id of ids ?? []) {
    const m = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
    if (!m) continue;
    const family = FAMILY_RANK[m[1]];
    const version = Number(m[2]) * 100 + Number(m[3] ?? 0);
    if (!best || family > best.family || (family === best.family && version > best.version)) best = { id, family, version };
  }
  return best?.id;
}

/** A model the connection names wins (the user chose it); otherwise the strongest the endpoint lists. */
export function pickBuilderModel(configured: string | undefined, listed: string[] | null | undefined): string | undefined {
  return configured?.trim() || strongestModel(listed);
}

// --- names and paths ---


/** Bundle name used until the model labels the app; the first write renames it from the label. */
export const PLACEHOLDER_NAME = `${NAME_PREFIX}Draft`;
/** The iPad prefetches quick-action LWCs for offline use by this prefix (lifesciences-ios `quickActionComponentTriggerPrefix`). */
export const ACTION_PREFIX = "lscMobileQuickAction_";
export const prefixFor = (target: AppTarget): string => (target === "action" ? ACTION_PREFIX : NAME_PREFIX);
export const placeholderFor = (target: AppTarget): string => `${prefixFor(target)}Draft`;
export const isPlaceholder = (project: Pick<AppProject, "name" | "target">): boolean => project.name === placeholderFor(project.target);
export const TARGETS: AppTarget[] = ["home", "record", "action", "tab"];
export const PROVISIONAL_LABEL = "New app";
export const MAX_LABEL_CHARS = 40;

const pascal = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** `lscMobileInline_` + the label in PascalCase, at most 40 characters after the prefix. */
export function nameFromLabel(label: string, target: AppTarget = "home"): string {
  const base = (label.replace(/['’]/g, "").match(/[A-Za-z0-9]+/g) ?? []).map(pascal).join("").replace(/^[0-9]+/, "").slice(0, 40);
  return `${prefixFor(target)}${base || "App"}`;
}

/** `name` made unique among `taken` (case-insensitive) with a numeric suffix. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    if (!used.has(`${name}${n}`.toLowerCase())) return `${name}${n}`;
  }
}

/** Files with the bundle `from` renamed to `to`, in paths and wherever the whole name appears in sources. */
export function renameBundle(files: AppFile[], from: string, to: string): AppFile[] {
  const re = new RegExp(`\\b${from}\\b`, "g");
  return files.map((f) => (f.bundle === from ? { bundle: to, path: f.path.replace(re, to), source: f.source.replace(re, to) } : { ...f, source: f.source.replace(re, to) }));
}

const BUNDLE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Split "lwc/<bundle>/<file>" strictly; null for anything else (traversal, nesting, odd characters). */
export function parseAppPath(p: unknown): { bundle: string; file: string } | null {
  if (typeof p !== "string") return null;
  const parts = p.split("/");
  if (parts.length !== 3 || parts[0] !== "lwc") return null;
  const [, bundle, file] = parts;
  if (!BUNDLE_RE.test(bundle) || !FILE_RE.test(file) || file.includes("..")) return null;
  return { bundle, file };
}

// --- tools offered to the model ---

export const BUILDER_TOOLS: ToolDefinition[] = [
  {
    name: "describe_objects",
    description:
      "Read the org's real schema for up to 8 objects: whether each exists and is synced to the iPad, its fields (API name, label, type, picklist values, lookups) and child relationships. Call this before writing code that touches an object, and use only the field names it returns.",
    input_schema: {
      type: "object",
      properties: { objects: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "Object API names, e.g. [\"Account\", \"RecommendedAction\"]" } },
      required: ["objects"],
    },
  },
  {
    name: "sample_records",
    description: "Look at up to 5 real records with a SELECT query (LIMIT is forced to 5 or less), to see what the data looks like. Read-only.",
    input_schema: {
      type: "object",
      properties: { soql: { type: "string", description: "A SOQL SELECT statement" } },
      required: ["soql"],
    },
  },
  {
    name: "write_app",
    description:
      "Write or change the app's files. Send every file you add or change in full (unchanged files may be left out) and list files to remove in `delete`. Paths are lwc/<bundle>/<file>: the app's own bundle is the name given to you; helper components are separate bundles without the lscMobileInline_ prefix. The result lists the problems found by compiling and checking the app; fix them with another write_app.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", maxLength: 40, description: "Required on the first write: a short human name in sentence case, at most 40 characters, e.g. \"Next best actions\". The app's API name is derived from it. Later, only send it to rename." },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string", description: "lwc/<bundle>/<file>, e.g. lwc/lscMobileInline_Todo/lscMobileInline_Todo.js" }, source: { type: "string", description: "The complete file contents" } },
            required: ["path", "source"],
          },
        },
        delete: { type: "array", items: { type: "string" }, description: "Paths of files to remove" },
        notes: { type: "string", description: "One line on what changed in this version" },
      },
      required: ["files"],
    },
  },
  {
    name: "finish",
    description: "End the turn once the app is written and passes its checks (or when no change is needed). The summary is shown to the user: say what the app does and what to look at, in plain words.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "A short plain-language summary for the user" } },
      required: ["summary"],
    },
  },
];

const TARGET_RULES: Record<AppTarget, (p: AppProject) => string> = {
  home: () => "Home page card (lightning__HomePage and lightning__UrlAddressable, mobileHeight property)",
  record: (p) => `Record page tab of ${p.objectApiName} (lightning__RecordPage and lightning__RecordAction; @api recordId and objectApiName)`,
  action: (p) => `LWC quick action on ${p.objectApiName}, opened from the record's action menu. The bundle name starts with lscMobileQuickAction_ (never lscMobileInline_); it takes @api recordId.`,
  tab: () => "A custom tab in the iPad's navigation bar",
};

const FALLBACK_GUIDE = `You build LSC Apps: Lightning web components named lscMobileInline_<Name> that run inside the Life Sciences Cloud mobile app on the iPad, often offline.
Rules: the parent bundle name starts with lscMobileInline_. Its .js-meta.xml sets isExposed=true. For a Home page app use targets lightning__HomePage and lightning__UrlAddressable, with a lightning__HomePage targetConfig holding an Integer property mobileHeight. For a record page app use lightning__RecordPage and lightning__RecordAction, with the same mobileHeight property on lightning__RecordPage, and take @api recordId and @api objectApiName.
Work offline-first: read data with GraphQL from lightning/uiGraphQLApi (a static query in a gql template literal) or lightning/uiRecordApi; avoid Apex, fetch and other network-only calls. Use only fields returned by describe_objects. OmniStudio is not available on the iPad.
Workflow: describe the objects you need, look at a few sample records, write the app with write_app, fix every problem its result lists, then call finish with a short summary.`;

// --- helpers for the tool results ---

function issueLine(i: AppIssue): string {
  const where = i.path ? ` (${i.path.replace(/^lwc\/[^/]+\//, "")}${i.line ? `:${i.line}` : ""})` : "";
  return `- [${i.rule}]${where} ${i.message}${i.fix ? ` Fix: ${i.fix}` : ""}`;
}

/** What the model reads after a write: errors and warnings with fixes, never the compiled script. */
export function checkSummary(check: Pick<AppCheckResult, "ok" | "issues" | "objects">): string {
  const errors = check.issues.filter((i) => i.severity === "error");
  const warnings = check.issues.filter((i) => i.severity === "warning");
  const lines: string[] = [];
  if (check.ok) lines.push("The app compiles and passes the checks.");
  else lines.push(`The app does not pass yet: ${errors.length} error${errors.length === 1 ? "" : "s"}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}. Fix the errors with another write_app.`);
  if (errors.length) lines.push("Errors:", ...errors.map(issueLine));
  if (warnings.length) lines.push("Warnings:", ...warnings.map(issueLine));
  const unsynced = (check.objects ?? []).filter((o) => o.synced === false).map((o) => o.name);
  if (unsynced.length) lines.push(`Not synced to the iPad by DB Schema (the app will show no data offline until they are): ${unsynced.join(", ")}. Tell the user in your summary.`);
  return lines.join("\n");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Compact description of a describe result so the model isn't handed 120 fields of JSON per object it can't use. */
function describeText(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * Follow a streaming write_app input loosely: the last `"path":"…"` seen so far, and the characters
 * received. The JSON is usually incomplete, so this scans text rather than parsing.
 */
export function followWrite(partial: string): { path?: string; chars: number } {
  let path: string | undefined;
  const re = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(partial); m; m = re.exec(partial)) path = m[1].replace(/\\(.)/g, "$1");
  return { path, chars: partial.length };
}

const nowIso = () => new Date().toISOString();

interface ActiveRun {
  abort: { aborted: boolean };
  abortNow: () => void;
  project: AppProject;
}

export class AppBuilder {
  private runs = new Map<string, ActiveRun>();
  private timers = new Map<string, NodeJS.Timeout>();
  /** Compiled scripts by version id, so the preview doesn't compile twice. */
  private scripts = new Map<string, { script?: string; placeholders: string[]; check: AppCheckResult }>();

  constructor(private deps: AppBuilderDeps) {}

  // --- reading ---

  /** A project as it is now, including a running turn's unsaved progress. */
  get(id: string): AppProject | null {
    return this.runs.get(id)?.project ?? this.deps.store.get(id);
  }

  list(org: string): AppProject[] {
    const stored = this.deps.store.list(org);
    return stored.map((p) => this.runs.get(p.id)?.project ?? p);
  }

  isRunning(id: string): boolean {
    return this.runs.has(id);
  }

  // --- projects ---

  /** Create a project from a first prompt and start its first turn; the turn runs in the background. */
  async create(org: string, input: { prompt: string; target: AppTarget; objectApiName?: string; runAs?: AppRunAs }): Promise<{ project?: AppProject; error?: string }> {
    const prompt = input.prompt?.trim();
    if (!prompt) return { error: "Describe the app first." };
    if (!TARGETS.includes(input.target)) return { error: "Choose where the app goes: Home page, record page, record action or tab." };
    if ((input.target === "record" || input.target === "action") && !input.objectApiName?.trim()) return { error: "Choose the object the app is for." };
    if (!this.deps.llm()) return { error: "The model connection isn't ready." };

    const at = nowIso();
    const project: AppProject = {
      id: randomUUID(),
      org: org.toLowerCase(),
      name: placeholderFor(input.target),
      label: PROVISIONAL_LABEL,
      target: input.target,
      ...(input.objectApiName?.trim() && (input.target === "record" || input.target === "action") ? { objectApiName: input.objectApiName.trim() } : {}),
      ...(input.runAs ? { runAs: input.runAs } : {}),
      createdAt: at,
      updatedAt: at,
      turns: [],
      versions: [],
      currentVersionId: null,
    };
    this.deps.store.save(project);
    this.startTurn(project, prompt);
    return { project: this.get(project.id) ?? project };
  }

  send(id: string, prompt: string): { ok: boolean; error?: string } {
    const project = this.deps.store.get(id);
    if (!project) return { ok: false, error: "That app no longer exists." };
    if (this.runs.has(id)) return { ok: false, error: "Roz is still working on this app. Stop it first or wait." };
    if (!prompt?.trim()) return { ok: false, error: "Write what to change." };
    if (!this.deps.llm()) return { ok: false, error: "The model connection isn't ready." };
    this.startTurn(project, prompt.trim());
    return { ok: true };
  }

  stop(id: string): void {
    this.runs.get(id)?.abortNow();
  }

  delete(id: string): void {
    this.stop(id);
    this.clearTimer(id);
    this.runs.delete(id);
    this.deps.store.delete(id);
  }

  setRunAs(id: string, runAs: AppRunAs | null): void {
    const project = this.get(id);
    if (!project) return;
    if (runAs) project.runAs = runAs;
    else delete project.runAs;
    project.updatedAt = nowIso();
    this.deps.store.save(project);
  }

  setTabSettings(id: string, tab: AppTabSettings | null): void {
    const project = this.get(id);
    if (!project) return;
    if (tab) project.tab = tab;
    else delete project.tab;
    project.updatedAt = nowIso();
    this.deps.store.save(project);
  }

  rename(id: string, label: string): void {
    const project = this.get(id);
    if (!project || !label.trim()) return;
    project.label = label.trim();
    project.updatedAt = nowIso();
    this.deps.store.save(project);
  }

  /** Copy an old version as the new current one. */
  restore(id: string, versionId: string): { version?: AppVersion; error?: string } {
    const project = this.get(id);
    const old = project?.versions.find((v) => v.id === versionId);
    if (!project || !old) return { error: "That version no longer exists." };
    if (this.runs.has(id)) return { error: "Wait for the current turn to finish." };
    const n = project.versions.indexOf(old) + 1;
    const version: AppVersion = {
      id: randomUUID(),
      at: nowIso(),
      source: "manual",
      files: old.files.map((f) => ({ ...f })),
      check: old.check,
      note: `Restored version ${n}`,
    };
    this.addVersion(project, version, true);
    this.deps.store.save(project);
    this.deps.emit(project.id, { type: "version", version });
    return { version };
  }

  /** A manual edit of one file: a new version, checked. */
  async editFile(id: string, path: string, source: string): Promise<{ version?: AppVersion; error?: string }> {
    const project = this.get(id);
    if (!project) return { error: "That app no longer exists." };
    if (this.runs.has(id)) return { error: "Wait for the current turn to finish." };
    const parsed = parseAppPath(path);
    if (!parsed) return { error: `"${path}" isn't a valid file path.` };
    if (typeof source !== "string" || source.length > MAX_SOURCE_CHARS) return { error: "That file is too large." };
    const files = new Map(this.currentFiles(project).map((f) => [f.path, f] as const));
    files.set(path, { bundle: parsed.bundle, path, source });
    let check: AppCheckResult;
    try {
      check = await this.runCheck(project, [...files.values()]);
    } catch (error) {
      return { error: `Couldn't check the change: ${message(error)}` };
    }
    const version: AppVersion = { id: randomUUID(), at: nowIso(), source: "manual", files: [...files.values()], check: stripScript(check), note: `Edited ${parsed.file}` };
    this.rememberScript(version.id, check);
    this.addVersion(project, version, true);
    this.deps.store.save(project);
    this.deps.emit(project.id, { type: "version", version });
    return { version };
  }

  /** The compiled script and checks for a version (the current one when none is named). */
  async preview(id: string, versionId?: string): Promise<{ script?: string; placeholders: string[]; check?: AppCheckResult; error?: string }> {
    const project = this.get(id);
    if (!project) return { placeholders: [], error: "That app no longer exists." };
    const version = versionId ? project.versions.find((v) => v.id === versionId) : this.currentVersion(project);
    if (!version) return { placeholders: [], error: "There's no version to preview yet." };
    const cached = this.scripts.get(version.id);
    if (cached) return { script: cached.script, placeholders: cached.placeholders, check: cached.check };
    try {
      const check = await this.runCheck(project, version.files);
      this.rememberScript(version.id, check);
      return { script: check.script, placeholders: check.placeholders ?? [], check };
    } catch (error) {
      return { placeholders: [], error: message(error) };
    }
  }

  /** Import an app that's already in the org as the first ("org") version of a new project. */
  async import(org: string, name: string): Promise<{ project?: AppProject; error?: string }> {
    const existing = this.deps.store.list(org).find((p) => p.importedFrom === name);
    if (existing) return { project: this.get(existing.id) ?? existing };
    let source: { name: string; target: AppTarget; objectApiName?: string; files: AppFile[] };
    try {
      source = (await this.deps.call("studio_app_source", { name }, 120_000)) as typeof source;
    } catch (error) {
      return { error: message(error) };
    }
    if (!source.files?.length) return { error: `${name} has no files to import.` };
    const at = nowIso();
    const project: AppProject = {
      id: randomUUID(),
      org: org.toLowerCase(),
      name: source.name || name,
      label: await this.orgAppLabel(name),
      target: TARGETS.includes(source.target) ? source.target : "home",
      ...(source.objectApiName ? { objectApiName: source.objectApiName } : {}),
      createdAt: at,
      updatedAt: at,
      turns: [],
      versions: [],
      currentVersionId: null,
      importedFrom: name,
    };
    let check: AppCheckResult;
    try {
      check = await this.runCheck(project, source.files);
    } catch (error) {
      return { error: `Couldn't check ${name}: ${message(error)}` };
    }
    const version: AppVersion = { id: randomUUID(), at, source: "org", files: source.files, check: stripScript(check), note: "Imported from the org" };
    this.rememberScript(version.id, check);
    this.addVersion(project, version, true);
    this.deps.store.save(project);
    return { project };
  }

  /**
   * Start a project from a starter app (`studio_app_starter_source`): its files are the first ("starter") version.
   * An untouched project from the same starter is reopened; otherwise the bundle is renamed if the org or another
   * project already uses its name.
   */
  async fromStarter(org: string, id: string, runAs?: AppRunAs): Promise<{ project?: AppProject; error?: string }> {
    const untouched = this.deps.store.list(org).find((p) => p.starter?.id === id && !p.turns.length && !p.deployed && p.versions.length === 1);
    if (untouched) return { project: this.get(untouched.id) ?? untouched };
    let source: { name: string; target: AppTarget; objectApiName?: string; files: AppFile[]; starter: AppStarter };
    try {
      source = (await this.deps.call("studio_app_starter_source", { id }, 60_000)) as typeof source;
    } catch (error) {
      return { error: message(error) };
    }
    if (!source.files?.length || !TARGETS.includes(source.target)) return { error: `The starter ${id} can't be opened.` };
    const at = nowIso();
    const { starter } = source;
    const project: AppProject = {
      id: randomUUID(),
      org: org.toLowerCase(),
      name: source.name,
      label: starter.label,
      target: source.target,
      ...(source.objectApiName ? { objectApiName: source.objectApiName } : {}),
      createdAt: at,
      updatedAt: at,
      turns: [],
      versions: [],
      currentVersionId: null,
      starter: { id: starter.id, label: starter.label, description: starter.description, repo: starter.repo, sha: starter.sha, url: starter.url, tryNext: starter.tryNext ?? [] },
      ...(runAs ? { runAs } : {}),
    };
    project.name = await this.availableName(project, source.name);
    const files = project.name === source.name ? source.files : renameBundle(source.files, source.name, project.name);
    let check: AppCheckResult;
    try {
      check = await this.runCheck(project, files);
    } catch (error) {
      return { error: `Couldn't check ${starter.label}: ${message(error)}` };
    }
    const version: AppVersion = { id: randomUUID(), at, source: "starter", files, check: stripScript(check), note: `Started from ${starter.repo}` };
    this.rememberScript(version.id, check);
    this.addVersion(project, version, true);
    this.deps.store.save(project);
    return { project };
  }

  private async orgAppLabel(name: string): Promise<string> {
    try {
      const data = (await this.deps.call("studio_app_list", {}, 60_000)) as { apps?: OrgApp[] };
      return data.apps?.find((a) => a.name === name)?.label || name.replace(NAME_PREFIX, "");
    } catch {
      return name.replace(NAME_PREFIX, "");
    }
  }

  /** Record a successful deploy. */
  markDeployed(id: string, deployed: string[]): void {
    const project = this.get(id);
    const version = project && this.currentVersion(project);
    if (!project || !version) return;
    project.deployed = { versionId: version.id, at: nowIso(), deployed };
    project.updatedAt = nowIso();
    this.deps.store.save(project);
  }

  currentVersion(project: AppProject): AppVersion | undefined {
    return project.versions.find((v) => v.id === project.currentVersionId) ?? project.versions[project.versions.length - 1];
  }

  currentFiles(project: AppProject): AppFile[] {
    return this.currentVersion(project)?.files ?? [];
  }

  // --- internals ---

  private rememberScript(versionId: string, check: AppCheckResult): void {
    this.scripts.set(versionId, { script: check.script, placeholders: check.placeholders ?? [], check });
    if (this.scripts.size > 40) this.scripts.delete(this.scripts.keys().next().value as string);
  }

  private async runCheck(project: AppProject, files: AppFile[]): Promise<AppCheckResult> {
    const args: Record<string, unknown> = { name: project.name, target: project.target, files };
    if (project.objectApiName) args.objectApiName = project.objectApiName;
    if (project.runAs?.userId) args.userId = project.runAs.userId;
    if (project.runAs?.profile) args.profile = project.runAs.profile;
    return (await this.deps.call("studio_app_check", args, 180_000)) as AppCheckResult;
  }

  private addVersion(project: AppProject, version: AppVersion, current: boolean): void {
    project.versions.push(version);
    if (current) project.currentVersionId = version.id;
    project.updatedAt = nowIso();
  }

  private clearTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  /** Save soon, not on every delta. */
  private persist(project: AppProject, now = false): void {
    this.clearTimer(project.id);
    if (now) {
      this.deps.store.save(project);
      return;
    }
    this.timers.set(
      project.id,
      setTimeout(() => {
        this.timers.delete(project.id);
        this.deps.store.save(project);
      }, SAVE_DEBOUNCE_MS)
    );
  }

  private startTurn(project: AppProject, prompt: string): void {
    const turn: AppTurn = { id: randomUUID(), prompt, at: nowIso(), status: "running", steps: [], reply: "" };
    project.turns.push(turn);
    project.updatedAt = nowIso();
    const abort = { aborted: false };
    let abortNow = () => {};
    const aborted = new Promise<never>((_, reject) => {
      abortNow = () => {
        abort.aborted = true;
        reject(new Error("aborted"));
      };
    });
    aborted.catch(() => {});
    this.runs.set(project.id, { abort, abortNow, project });
    this.persist(project, true);
    this.deps.emit(project.id, { type: "turn", turn: structuredClone(turn) });
    void this.runTurn(project, turn, abort, aborted).finally(() => {
      this.runs.delete(project.id);
      this.persist(project, true);
    });
  }

  private async runTurn(project: AppProject, turn: AppTurn, abort: { aborted: boolean }, aborted: Promise<never>): Promise<void> {
    const emit = (event: AppBuilderEvent) => {
      if (!abort.aborted || event.type === "turn") this.deps.emit(project.id, event);
    };
    const steps = new Map<string, AppStep>();
    const startStep = (kind: AppStep["kind"], label: string): AppStep => {
      const step: AppStep = { id: randomUUID(), kind, label, status: "running", startedAt: nowIso() };
      turn.steps.push(step);
      steps.set(step.id, step);
      emit({ type: "step", turnId: turn.id, step: { ...step } });
      this.persist(project);
      return step;
    };
    const endStep = (step: AppStep, status: "done" | "failed", patch: Partial<Pick<AppStep, "label" | "detail">> = {}) => {
      Object.assign(step, patch, { status, endedAt: nowIso() });
      emit({ type: "step", turnId: turn.id, step: { ...step } });
      this.persist(project);
    };
    const setStatus = (status: AppTurn["status"], error?: string) => {
      turn.status = status;
      if (error) turn.error = error;
      project.updatedAt = nowIso();
      this.persist(project, true);
      this.deps.emit(project.id, { type: "turn", turn: structuredClone(turn) });
    };
    const appendReply = (text: string) => {
      if (!text) return;
      turn.reply += text;
      emit({ type: "reply-delta", turnId: turn.id, text });
      this.persist(project);
    };

    const llm = this.deps.llm();
    if (!llm) {
      setStatus("failed", "The model connection isn't ready.");
      return;
    }

    // The working copy of the files: this turn's writes merge into it.
    const working = new Map<string, AppFile>(this.currentFiles(project).map((f) => [f.path, { ...f }]));
    const priorCheck = this.currentVersion(project)?.check;
    let turnVersion: AppVersion | undefined;
    let lastWriteOk: boolean | null = null;
    let lastIssues = 0;
    let failingWrites = 0;
    let finished = false;
    let summary = "";

    try {
      if (project.runAs) await this.runAsArgs(project);
      const system = await this.systemPrompt();
      const messages: Message[] = [{ role: "user", content: this.contextMessage(project, turn, [...working.values()], priorCheck) }];

      for (let round = 0; round < MAX_ROUNDS && !finished; round++) {
        if (abort.aborted) throw new Error("aborted");

        // Streaming bookkeeping for this round's tool calls.
        const calls = new Map<string, { name: string; json: string }>();
        let currentId = "";
        let lastWritingEmit = 0;
        let textThisRound = false;
        const onChunk = (chunk: StreamChunk) => {
          if (abort.aborted) return;
          if (chunk.type === "text_delta" && chunk.text) {
            // Text after a tool round starts a new paragraph, or rounds run together ("first.Writing").
            if (!textThisRound && turn.reply && !/\s$/.test(turn.reply)) appendReply("\n\n");
            textThisRound = true;
            appendReply(chunk.text);
          }
          else if (chunk.type === "tool_use_start" && chunk.id) {
            currentId = chunk.id;
            calls.set(chunk.id, { name: chunk.name ?? "", json: "" });
          } else if (chunk.type === "tool_use_delta" && chunk.input_json && currentId) {
            const call = calls.get(currentId);
            if (!call) return;
            call.json += chunk.input_json;
            if (call.name === "write_app") {
              const t = Date.now();
              if (t - lastWritingEmit > 150) {
                lastWritingEmit = t;
                const { path, chars } = followWrite(call.json);
                emit({ type: "writing", turnId: turn.id, path: path ?? "", chars });
              }
            }
          }
        };

        const response = await Promise.race([llm.chat(system, messages, BUILDER_TOOLS, { model: this.deps.model(), maxTokens: MAX_TOKENS, cache: process.env.LSC_BUILDER_CACHE !== "0" }, onChunk), aborted]);
        if (abort.aborted) throw new Error("aborted");
        messages.push(response);

        const content = (typeof response.content === "string" ? [{ type: "text", text: response.content } as ContentBlock] : response.content) as ContentBlock[];
        const toolCalls = content.filter((b) => b.type === "tool_use");
        if (toolCalls.length === 0) break; // the model ended its turn without finish

        const results: ContentBlock[] = [];
        for (const call of toolCalls) {
          if (abort.aborted) throw new Error("aborted");
          const input = (call.input ?? {}) as Record<string, unknown>;
          let text: string;
          let isError = false;
          try {
            if (call.name === "describe_objects") {
              text = await this.toolDescribe(project, input, startStep, endStep);
            } else if (call.name === "sample_records") {
              text = await this.toolSample(project, input, startStep, endStep);
            } else if (call.name === "write_app") {
              const out = await this.toolWrite({
                project,
                turn,
                input,
                working,
                priorFailing: lastWriteOk === false,
                priorIssues: lastIssues,
                startStep,
                endStep,
                emit,
                aborted,
              });
              text = out.text;
              isError = out.rejected;
              lastWriteOk = out.ok;
              lastIssues = out.errors;
              if (out.version) {
                if (out.version.check.ok) turnVersion = out.version;
                turn.versionId = turnVersion?.id;
              }
              failingWrites = out.ok ? 0 : failingWrites + 1;
              if (failingWrites >= MAX_FAILING_WRITES) {
                results.push({ type: "tool_result", tool_use_id: call.id, content: text, is_error: isError });
                throw new GaveUp();
              }
            } else if (call.name === "finish") {
              if (lastWriteOk === false) {
                text = "The latest version still has errors. Fix them with write_app before finishing.";
                isError = true;
              } else {
                finished = true;
                summary = typeof input.summary === "string" ? input.summary.trim() : "";
                text = "Done.";
              }
            } else {
              text = `Unknown tool ${call.name}.`;
              isError = true;
            }
          } catch (error) {
            if (error instanceof GaveUp || error instanceof LoginExpiredError || abort.aborted) throw error;
            text = `Error: ${message(error)}`;
            isError = true;
          }
          results.push({ type: "tool_result", tool_use_id: call.id, content: text, is_error: isError });
        }
        messages.push({ role: "user", content: results });
      }

      if (summary && !turn.reply.includes(summary)) appendReply(`${turn.reply ? "\n\n" : ""}${summary}`);
      if (lastWriteOk === false && !finished) {
        setStatus("failed", turnVersion ? "Roz stopped before fixing every problem. The last version that passed its checks is kept." : "Roz stopped before the app passed its checks.");
      } else {
        setStatus("done");
      }
    } catch (error) {
      if (error instanceof GaveUp) {
        const kept = turnVersion ? " The last version that passed its checks is kept." : "";
        setStatus("failed", `The app still didn't pass its checks after ${MAX_FAILING_WRITES} tries.${kept}`);
      } else if (abort.aborted) {
        for (const s of steps.values()) if (s.status === "running") Object.assign(s, { status: "failed", endedAt: nowIso(), detail: "Stopped" });
        setStatus("stopped");
      } else {
        for (const s of steps.values()) if (s.status === "running") Object.assign(s, { status: "failed", endedAt: nowIso() });
        setStatus("failed", message(error));
      }
    }
  }

  /** `name`, made unique against the org's apps and this org's other projects. */
  private async availableName(project: AppProject, name: string): Promise<string> {
    const taken = new Set<string>(this.deps.store.list(project.org).filter((p) => p.id !== project.id && !isPlaceholder(p)).map((p) => p.name));
    try {
      const data = (await this.deps.call("studio_app_list", {}, 60_000)) as { apps?: OrgApp[] };
      for (const a of data.apps ?? []) taken.add(a.name);
    } catch {
      // Unique among projects; a clash with an org app surfaces at deploy.
    }
    return uniqueName(name, taken);
  }

  private async systemPrompt(): Promise<string> {
    try {
      const data = (await this.deps.call("studio_app_guide", {}, 30_000)) as { guide?: string };
      if (data.guide?.trim()) return data.guide;
    } catch {
      // fall through to the short built-in prompt
    }
    return FALLBACK_GUIDE;
  }

  private contextMessage(project: AppProject, turn: AppTurn, files: AppFile[], check: AppVersion["check"] | undefined): string {
    const parts: string[] = [];
    parts.push(
      [
        "<app>",
        isPlaceholder(project) && !project.deployed
          ? `Name: ${project.name} (a placeholder: use exactly this as the parent bundle name in every path and file name; Roz renames the bundle from your label). Your first write_app must include a \`label\` (sentence case, at most ${MAX_LABEL_CHARS} characters, e.g. "Next best actions").`
          : `Name (the parent bundle's API name; use it exactly): ${project.name}\nLabel: ${project.label}`,
        `Target: ${TARGET_RULES[project.target](project)}`,
        project.runAs ? `Building for ${project.runAs.username}${project.runAs.profile ? ` (profile ${project.runAs.profile})` : ""}: describe_objects and sample_records show what they can see. Build for what they have access to.` : "",
        project.objectApiName ? `objectApiName: ${project.objectApiName}` : "",
        project.starter
          ? `Started from the starter app "${project.starter.label}" (github.com/${project.starter.repo})${project.starter.description ? `: ${project.starter.description}` : ""}. Keep its structure and its helper bundles' names unless the request asks otherwise.`
          : "",
        "</app>",
      ]
        .filter(Boolean)
        .join("\n")
    );
    const earlier = project.turns.filter((t) => t.id !== turn.id && t.status !== "running");
    if (earlier.length) {
      parts.push(
        "<earlier_requests>\n" +
          earlier
            .slice(-6)
            .map((t) => `- ${t.prompt}${t.reply ? `\n  You answered: ${t.reply.replace(/\s+/g, " ").slice(0, 300)}` : ""}`)
            .join("\n") +
          "\n</earlier_requests>"
      );
    }
    if (files.length) {
      parts.push(
        "<current_files>\nThese are the app's files now. write_app merges into them: send only the files you change (each in full) and leave the rest out. A change that touches one file should rewrite only that file.\n" +
          files.map((f) => `--- ${f.path}\n${f.source}`).join("\n") +
          "\n</current_files>"
      );
      const bad = check?.issues.filter((i) => i.severity !== "info") ?? [];
      if (bad.length) parts.push(`<last_check>\n${checkSummary({ ok: check!.ok, issues: check!.issues, objects: check!.objects })}\n</last_check>`);
    } else {
      parts.push("There are no files yet: this is a new app.");
    }
    parts.push(`<request>\n${turn.prompt}\n</request>`);
    return parts.join("\n\n");
  }

  // --- the model's tools ---

  /** The test user's token for data reads, resolved fresh each call; throws a plain error when the login is gone. */
  async runAsArgs(project: AppProject): Promise<Record<string, unknown>> {
    const runAs = project.runAs;
    if (!runAs) return {};
    if (!this.deps.mobileLogin) throw new Error(`Can't build as ${runAs.username} here.`);
    try {
      return { mobileLogin: await this.deps.mobileLogin(runAs.loginId) };
    } catch {
      throw new LoginExpiredError(`${runAs.username}'s login expired — sign in again.`);
    }
  }

  private async toolDescribe(project: AppProject, input: Record<string, unknown>, startStep: StartStep, endStep: EndStep): Promise<string> {
    const objects = Array.isArray(input.objects) ? input.objects.filter((o): o is string => typeof o === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(o)).slice(0, 8) : [];
    if (!objects.length) throw new Error("describe_objects needs a list of object API names.");
    const step = startStep("describe", `Reading ${objects.slice(0, 3).join(", ")}${objects.length > 3 ? ` and ${objects.length - 3} more` : ""} fields`);
    try {
      const data = await this.deps.call("studio_app_describe", { objects, ...(await this.runAsArgs(project)) }, 120_000);
      const missing = ((data as { objects?: Array<{ name: string; exists: boolean }> }).objects ?? []).filter((o) => !o.exists).map((o) => o.name);
      endStep(step, "done", missing.length ? { detail: `Not found: ${missing.join(", ")}` } : {});
      return describeText(data);
    } catch (error) {
      endStep(step, "failed", { detail: message(error) });
      throw expiredFromServer(error);
    }
  }

  private async toolSample(project: AppProject, input: Record<string, unknown>, startStep: StartStep, endStep: EndStep): Promise<string> {
    const soql = typeof input.soql === "string" ? input.soql.trim() : "";
    if (!soql) throw new Error("sample_records needs a SOQL SELECT.");
    const from = /\bfrom\s+([A-Za-z0-9_]+)/i.exec(soql)?.[1];
    const step = startStep("sample", from ? `Looking at ${from} records` : "Looking at sample records");
    try {
      const data = (await this.deps.call("studio_app_sample", { soql, ...(await this.runAsArgs(project)) }, 120_000)) as { records?: unknown[]; totalSize?: number };
      const n = data.records?.length ?? 0;
      endStep(step, "done", { label: `Looking at ${plural(n, "sample record")}${from ? ` of ${from}` : ""}` });
      return JSON.stringify(data);
    } catch (error) {
      endStep(step, "failed", { detail: message(error) });
      throw expiredFromServer(error);
    }
  }

  private async toolWrite(ctx: {
    project: AppProject;
    turn: AppTurn;
    input: Record<string, unknown>;
    working: Map<string, AppFile>;
    priorFailing: boolean;
    priorIssues: number;
    startStep: StartStep;
    endStep: EndStep;
    emit: (event: AppBuilderEvent) => void;
    aborted: Promise<never>;
  }): Promise<{ text: string; ok: boolean; rejected: boolean; errors: number; version?: AppVersion }> {
    const { project, turn, input, working, startStep, endStep } = ctx;
    const rawFiles = Array.isArray(input.files) ? (input.files as unknown[]) : [];
    const rawDelete = Array.isArray(input.delete) ? (input.delete as unknown[]) : [];
    const kind = ctx.priorFailing ? "repair" : "write";
    const step = startStep(kind, kind === "repair" ? `Fixing ${plural(ctx.priorIssues || 1, "problem")}` : "Writing the app");

    const reject = (why: string) => {
      endStep(step, "failed", { detail: why });
      return { text: `Not written: ${why}`, ok: false, rejected: true, errors: ctx.priorIssues };
    };

    if (!rawFiles.length && !rawDelete.length) {
      return reject("write_app came through empty. Your output may have been cut off; send fewer, smaller files per call.");
    }
    if (rawFiles.length > MAX_FILES_PER_WRITE) return reject(`too many files in one call (max ${MAX_FILES_PER_WRITE}).`);

    // The first write names the app: its bundle is renamed from the label the model gives.
    const placeholder = placeholderFor(project.target);
    const first = isPlaceholder(project) && !project.deployed;
    const label = typeof input.label === "string" ? input.label.trim().slice(0, MAX_LABEL_CHARS) : "";
    if (first && !label) return reject(`give the app a short \`label\` (sentence case, at most ${MAX_LABEL_CHARS} characters) with the first write_app.`);
    const target = first ? await this.availableName(project, nameFromLabel(label, project.target)) : project.name;
    // The placeholder maps to the app's real name in paths and sources, so a later write that still says it works.
    const rename = (text: string) => (target === placeholder ? text : text.split(placeholder).join(target));

    const incoming: AppFile[] = [];
    for (const f of rawFiles) {
      const file = f as { path?: unknown; source?: unknown };
      if (typeof file.path !== "string" || !parseAppPath(rename(file.path))) return reject(`"${String(file.path)}" isn't a valid path. Use lwc/<bundle>/<file>, with no subfolders or "..".`);
      const path = rename(file.path);
      const parsed = parseAppPath(path)!;
      if (typeof file.source !== "string") return reject(`${file.path} has no source.`);
      if (file.source.length > MAX_SOURCE_CHARS) return reject(`${file.path} is too large.`);
      // A prefixed helper the app already has (a starter's or an imported app's) may be changed; a new one may not.
      const known = [...working.values()].some((w) => w.bundle === parsed.bundle);
      if ((parsed.bundle.startsWith(NAME_PREFIX) || parsed.bundle.startsWith(ACTION_PREFIX)) && parsed.bundle !== target && !known) {
        return reject(`the app's bundle is ${first ? placeholder : target}; ${parsed.bundle} isn't allowed. Helper components must not start with ${NAME_PREFIX} or ${ACTION_PREFIX}.`);
      }
      incoming.push({ bundle: parsed.bundle, path, source: rename(file.source) });
    }
    const removals: string[] = [];
    for (const d of rawDelete) {
      if (typeof d !== "string" || !parseAppPath(rename(d))) return reject(`"${String(d)}" isn't a valid path to delete.`);
      removals.push(rename(d));
    }

    const next = new Map(working);
    for (const f of incoming) next.set(f.path, f);
    for (const d of removals) next.delete(d);
    if (![...next.values()].some((f) => f.bundle === target)) return reject(`the app has no files in its own bundle ${first ? placeholder : target}.`);

    // Accepted: this is the working copy now, even if the check fails (the repair edits it).
    working.clear();
    for (const [p, f] of next) working.set(p, f);
    if (first) project.name = target;
    if (label) project.label = label;
    const count = incoming.length + removals.length;
    endStep(step, "done", { label: kind === "repair" ? `${step.label} (${plural(count, "file")})` : `Writing the app (${plural(count, "file")})` });

    const checkStep = startStep("check", "Checking it compiles and runs offline");
    let check: AppCheckResult;
    try {
      check = (await Promise.race([this.runCheck(project, [...working.values()]), ctx.aborted])) as AppCheckResult;
    } catch (error) {
      if (error instanceof Error && error.message === "aborted") throw error;
      endStep(checkStep, "failed", { detail: message(error) });
      return { text: `The checks couldn't run: ${message(error)}`, ok: false, rejected: true, errors: ctx.priorIssues };
    }
    const errors = check.issues.filter((i) => i.severity === "error").length;
    endStep(checkStep, check.ok ? "done" : "failed", { detail: check.ok ? undefined : plural(errors, "problem") });

    const version: AppVersion = {
      id: randomUUID(),
      at: nowIso(),
      source: "ai",
      files: [...working.values()].map((f) => ({ ...f })),
      check: stripScript(check),
      turnId: turn.id,
      ...(typeof input.notes === "string" && input.notes.trim() ? { note: input.notes.trim() } : {}),
    };
    this.rememberScript(version.id, check);
    this.addVersion(project, version, check.ok);
    this.persist(project, true);
    ctx.emit({ type: "version", version });
    // The name and label were set by this write; the renderer's copy of the project still says "New app" until it hears.
    if (first || label) ctx.emit({ type: "project", project });
    const named = first ? `The app's API name is ${target}. Use that parent bundle name from now on.\n` : "";
    return { text: named + checkSummary(check), ok: check.ok, rejected: false, errors, version };
  }
}

type StartStep = (kind: AppStep["kind"], label: string) => AppStep;
type EndStep = (step: AppStep, status: "done" | "failed", patch?: Partial<Pick<AppStep, "label" | "detail">>) => void;

class LoginExpiredError extends Error {}

/** The server says "<user>'s login has expired — sign in again" on a 401; that ends the turn as-is, not a model-visible tool error. */
function expiredFromServer(error: unknown): unknown {
  return !(error instanceof LoginExpiredError) && /login has expired/i.test(message(error)) ? new LoginExpiredError(message(error)) : error;
}

class GaveUp extends Error {}

function stripScript(check: AppCheckResult): AppVersion["check"] {
  const { script: _script, ...rest } = check;
  void _script;
  return { ...rest, placeholders: rest.placeholders ?? [], issues: rest.issues ?? [] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
