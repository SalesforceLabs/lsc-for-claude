/**
 * Renderer copies of the Metadata cache page's types (`src/studio/metadata-cache-logic.ts`,
 * `src/studio/metadata-cache.ts`), plus how the page labels them.
 */

import type { StatusTone } from "../ui/StatusIcon";

export interface CacheRecordInfo {
  id: string;
  name: string;
  status: string;
  profile: string | null;
  profileId: string | null;
  createdAt: string;
  modifiedAt: string;
  createdBy: string | null;
  sizeBytes: number | null;
  hasDocument: boolean;
  error: string | null;
  log: string | null;
}

export type JobState = "running" | "done" | "failed";

export interface CacheJob {
  id: string;
  name: string;
  startedAt: string;
  updatedAt: string;
  startedBy: string | null;
  state: JobState;
  status: string;
  error: string | null;
  records: CacheRecordInfo[];
}

export type ProfileCacheState = "current" | "behind" | "failed" | "running" | "never";

export interface ProfileCacheRow {
  profile: string;
  profileId: string;
  users: number;
  live: CacheRecordInfo | null;
  attempt: CacheRecordInfo | null;
  attemptState: JobState | null;
  attemptError: string | null;
  unpublished: number | null;
  state: ProfileCacheState;
}

export interface MetadataCacheOverview {
  org: string;
  collectedAt: string;
  profiles: ProfileCacheRow[];
  jobs: CacheJob[];
  jobsTotal: number;
  notes: string[];
}

export interface CacheFile {
  path: string;
  size: number;
  compressed: number;
}

export interface CacheContents {
  recordId: string;
  name: string;
  profile: string | null;
  generatedAt: string;
  sizeBytes: number | null;
  files: CacheFile[];
  zipPath: string;
}

export interface CacheFileText {
  path: string;
  size: number;
  kind: "text" | "image" | "binary";
  text: string;
  image?: string;
  truncated: boolean;
}

export const PROFILE_STATE: Record<ProfileCacheState, { label: string; tone: StatusTone }> = {
  current: { label: "Up to date", tone: "pass" },
  behind: { label: "Behind", tone: "warning" },
  failed: { label: "Last publish failed", tone: "error" },
  running: { label: "Publishing", tone: "info" },
  never: { label: "Never published", tone: "warning" },
};

export const JOB_STATE: Record<JobState, { label: string; tone: StatusTone }> = {
  done: { label: "Done", tone: "pass" },
  failed: { label: "Failed", tone: "error" },
  running: { label: "Running", tone: "info" },
};

/** Pill classes take the tones `ui-pill` has. */
export const pillClass = (tone: StatusTone) =>
  `ui-pill${tone === "pass" || tone === "error" || tone === "warning" || tone === "info" ? ` ${tone}` : ""}`;

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function formatDuration(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The profiles a job built (or tried to). */
export const jobProfiles = (job: CacheJob) =>
  job.records.map((r) => r.profile).filter((p): p is string => !!p);

/** Files in a cache, filtered by a search term on their path. */
export function filterFiles(files: CacheFile[], term: string): CacheFile[] {
  const t = term.trim().toLowerCase();
  return t ? files.filter((f) => f.path.toLowerCase().includes(t)) : files;
}

/** The folder every file is in ("LS PH Field Sales Representative/metadata/"), so the list can show what tells them apart. */
export function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  let prefix = paths[0].slice(0, paths[0].lastIndexOf("/") + 1);
  for (const p of paths)
    while (prefix && !p.startsWith(prefix))
      prefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf("/") + 1);
  return prefix;
}

/** Files under their folder (relative to `root`), folders in order and loose files first. */
export function groupFiles(
  files: CacheFile[],
  root: string
): { folder: string; files: { file: CacheFile; name: string }[] }[] {
  const groups = new Map<string, { file: CacheFile; name: string }[]>();
  for (const f of files) {
    const rel = f.path.slice(root.length);
    const cut = rel.lastIndexOf("/");
    const folder = cut < 0 ? "" : rel.slice(0, cut);
    groups.set(folder, [...(groups.get(folder) ?? []), { file: f, name: rel.slice(cut + 1) }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([folder, files]) => ({ folder, files }));
}

/** A file's text as JSON when it parses, else null. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Log text sent to Roz at most, per publish. */
export const ASK_LOG_CHARS = 12_000;

/** What Roz is asked about a failed publish: the profiles, Salesforce's error and the logs. */
export function failedPublishPrompt(p: {
  profiles: string[];
  startedAt: string;
  startedBy: string | null;
  error: string | null;
  logs: { profile: string | null; log: string }[];
}): string {
  const who = p.profiles.length ? p.profiles.join(", ") : "an unknown profile";
  const lines = [
    `Publishing the LSC mobile metadata cache for ${who} failed. It was started ${formatWhen(p.startedAt)}${
      p.startedBy ? ` by ${p.startedBy}` : ""
    }.`,
  ];
  if (p.error) lines.push(`Salesforce's error: ${p.error}`);
  let room = ASK_LOG_CHARS;
  for (const l of p.logs) {
    if (room <= 0) break;
    const text = l.log.length > room ? `${l.log.slice(0, room)}\n… (cut)` : l.log;
    room -= text.length;
    lines.push(`Log${l.profile ? ` for ${l.profile}` : ""}:`, "```", text, "```");
  }
  if (!p.logs.length) lines.push("The publish logged nothing beyond that error.");
  lines.push(
    "What caused this, and what should I change in the org so the next Publish to iPad works?"
  );
  return lines.join("\n");
}
