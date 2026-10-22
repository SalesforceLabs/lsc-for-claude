import type { AppBuilderEvent, AppProject, AppTarget, AppStep, AppTurn, AppVersion } from "./types";

/** Apply one builder event to a project: turns and steps are upserted by id, replies append. */
export function applyEvent(p: AppProject, e: AppBuilderEvent): AppProject {
  switch (e.type) {
    case "project":
      return e.project;
    case "turn": {
      const has = p.turns.some((t) => t.id === e.turn.id);
      const turns = has ? p.turns.map((t) => (t.id === e.turn.id ? e.turn : t)) : [...p.turns, e.turn];
      return { ...p, turns, updatedAt: e.turn.at > p.updatedAt ? e.turn.at : p.updatedAt };
    }
    case "step":
      return mapTurn(p, e.turnId, (t) => ({ ...t, steps: upsert(t.steps, e.step) }));
    case "reply-delta":
      return mapTurn(p, e.turnId, (t) => ({ ...t, reply: t.reply + e.text }));
    case "version": {
      const versions = upsert(p.versions, e.version);
      return { ...p, versions, currentVersionId: e.version.id, updatedAt: e.version.at > p.updatedAt ? e.version.at : p.updatedAt };
    }
    case "writing":
      return p;
  }
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

function mapTurn(p: AppProject, id: string, f: (t: AppTurn) => AppTurn): AppProject {
  return p.turns.some((t) => t.id === id) ? { ...p, turns: p.turns.map((t) => (t.id === id ? f(t) : t)) } : p;
}

export type ProjectStatus = "building" | "failed" | "draft" | "deployed" | "changed";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  building: "Building…",
  failed: "Needs attention",
  draft: "Draft",
  deployed: "Deployed",
  changed: "Changed since deploy",
};

export const STATUS_TONE: Record<ProjectStatus, "info" | "error" | "neutral" | "pass" | "warning"> = {
  building: "info",
  failed: "error",
  draft: "neutral",
  deployed: "pass",
  changed: "warning",
};

export const isBuilding = (p: AppProject): boolean => p.turns.some((t) => t.status === "running");

export function projectStatus(p: AppProject): ProjectStatus {
  if (isBuilding(p)) return "building";
  if (p.deployed) return p.deployed.versionId === p.currentVersionId ? "deployed" : "changed";
  const last = p.turns[p.turns.length - 1];
  if (last?.status === "failed" && !p.versions.length) return "failed";
  return "draft";
}

/** "v3": a version's number in its project (1-based, oldest first). */
export function versionNumber(p: AppProject, versionId: string | null | undefined): number {
  return versionId ? p.versions.findIndex((v) => v.id === versionId) + 1 : 0;
}

export function versionSummary(p: AppProject, v: AppVersion): string {
  const errors = v.check.issues.filter((i) => i.severity === "error").length;
  const warnings = v.check.issues.filter((i) => i.severity === "warning").length;
  const parts = [`v${versionNumber(p, v.id)}`, errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : v.check.ok ? "compiles" : "doesn't compile"];
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(" · ");
}

export function versionTone(v: AppVersion): "pass" | "warning" | "error" {
  if (!v.check.ok) return "error";
  return v.check.issues.some((i) => i.severity === "warning") ? "warning" : "pass";
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} ${d === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function elapsed(step: Pick<AppStep, "startedAt" | "endedAt">, now = Date.now()): string {
  const s = Math.max(0, (step.endedAt ? Date.parse(step.endedAt) : now) - Date.parse(step.startedAt)) / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function chars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k chars` : `${n} chars`;
}

/** File name of a "lwc/<bundle>/<file>" path. */
export const fileName = (path: string): string => path.split("/").pop() ?? path;

export interface TargetInfo {
  value: AppTarget;
  label: string;
  /** One line for the picker. */
  hint: string;
  needsObject: boolean;
}

export const TARGETS: TargetInfo[] = [
  { value: "home", label: "Home page", hint: "A card on the iPad's Home page", needsObject: false },
  { value: "record", label: "Record page tab", hint: "A tab on one object's record page", needsObject: true },
  { value: "action", label: "Quick action", hint: "A screen that opens from a record's action menu", needsObject: true },
  { value: "tab", label: "Nav tab", hint: "A full-screen tab in the iPad's tab bar", needsObject: false },
];

export const needsObject = (t: AppTarget): boolean => TARGETS.find((x) => x.value === t)?.needsObject ?? false;

/** Where a project goes, for pills and headings. */
export function targetLabel(p: Pick<AppProject, "target" | "objectApiName">): string {
  const object = p.objectApiName ?? "Record";
  switch (p.target) {
    case "home":
      return "Home page";
    case "record":
      return `${object} page`;
    case "action":
      return `${object} action`;
    case "tab":
      return "Nav tab";
  }
}

/** Whether a file is shown first: the parent bundle's JS, then its HTML. */
export function fileOrder(a: { bundle: string; path: string }, b: { bundle: string; path: string }, parent: string): number {
  const rank = (f: { bundle: string; path: string }) => (f.bundle === parent ? 0 : 1) * 10 + (f.path.endsWith(".html") ? 0 : f.path.endsWith(".js") ? 1 : f.path.endsWith(".css") ? 2 : 3);
  return rank(a) - rank(b) || a.path.localeCompare(b.path);
}

export const EXAMPLES: { label: string; prompt: string; target: AppTarget; objectApiName?: string }[] = [
  {
    label: "Next best actions to-do list",
    prompt: "Show the rep a list of recommended actions from Next Best Action as a stylized to-do list; tapping one shows its details",
    target: "home",
  },
  { label: "This week's visits timeline", prompt: "This week's visits as a timeline with the next one highlighted", target: "home" },
  { label: "HCP snapshot", prompt: "An HCP snapshot on the Account page: specialty, last visit, open samples", target: "record", objectApiName: "Account" },
  { label: "Low sample inventory", prompt: "Sample inventory running low, with lot expiry warnings", target: "home" },
  { label: "Territory goals progress", prompt: "My activity plan goals this period as progress rings, with what is behind pace first", target: "home" },
  { label: "Log a sample request", prompt: "Log a quick sample request for this HCP with product and quantity", target: "action", objectApiName: "Account" },
  { label: "Territory leaderboard", prompt: "A territory leaderboard of my top 20 HCPs by Next Best Customer score", target: "tab" },
  { label: "Visit prep brief", prompt: "A pre-call brief on the Visit page: last three visits, products discussed, open commitments", target: "record", objectApiName: "Visit" },
];

export const COMMON_OBJECTS = ["Account", "Visit", "ProviderVisit", "Contact", "Product2", "ProductItem", "Location", "ActivityPlan", "ProviderActivityGoal", "Task", "Event", "ProviderAcctTerritoryInfo"];

/** A device the preview can draw. Only iPad is offered; an iPhone adds an entry here. */
export interface DeviceSpec {
  kind: "ipad" | "iphone";
  label: string;
  /** Points, in the device's natural (portrait) orientation. */
  width: number;
  height: number;
  /** Space the status bar and home indicator take, in points. */
  safe: { top: number; bottom: number };
  orientations: Orientation[];
}
export type Orientation = "landscape" | "portrait";

export const DEVICES: Record<DeviceSpec["kind"], DeviceSpec> = {
  ipad: { kind: "ipad", label: "iPad", width: 820, height: 1180, safe: { top: 24, bottom: 20 }, orientations: ["landscape", "portrait"] },
  iphone: { kind: "iphone", label: "iPhone", width: 393, height: 852, safe: { top: 54, bottom: 34 }, orientations: ["portrait"] },
};
/** iPads are mostly used in landscape. */
export const DEFAULT_ORIENTATION: Orientation = "landscape";

/** The screen's size in points once rotated. */
export function orientedSize(d: DeviceSpec, o: Orientation): { width: number; height: number } {
  return o === "landscape" ? { width: d.height, height: d.width } : { width: d.width, height: d.height };
}

/** Bezel around the screen, in points. */
export const BEZEL = 12;

/** How big the preview is drawn: whole into the pane, or at a fixed fraction of the iPad's points. */
export type Zoom = "fit" | "75" | "100";
export const ZOOMS: { value: Zoom; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: "75", label: "75%" },
  { value: "100", label: "100%" },
];

/** The device and its bezel as laid out in points, and the scale to draw it at: whole into the room there is (never above 1:1) for Fit, else the fixed fraction. */
export function fitDevice(d: DeviceSpec, o: Orientation, room: { width: number; height: number }, zoom: Zoom = "fit"): { width: number; height: number; scale: number } {
  const s = orientedSize(d, o);
  const width = s.width + BEZEL * 2;
  const height = s.height + BEZEL * 2;
  const fit = room.width > 0 && room.height > 0 ? Math.min(1, room.width / width, room.height / height) : 1;
  return { width, height, scale: zoom === "fit" ? fit : zoom === "75" ? 0.75 : 1 };
}

/** The parent bundle's name: the one that isn't a `c/` child, from the files of the version shown. */
export function parentBundle(files: { bundle: string }[], fallback: string): string {
  return [...new Set(files.map((f) => f.bundle))].find((b) => b.startsWith("lscMobileInline_")) ?? files[0]?.bundle ?? fallback;
}

/**
 * The profile to open the iPad preview on for "Add to iPad": the run-as user's profile when the org has it,
 * else the field sales rep profile with the most users, else the largest that isn't an admin, integration, community or minimum-access profile.
 */
export function suggestProfile(profiles: { name: string; users: number }[], preferred?: string): string | null {
  if (preferred && profiles.some((p) => p.name === preferred)) return preferred;
  const rep = profiles.filter((p) => p.users > 0 && !/admin|integration|community|minimum access|^\*/i.test(p.name));
  // A field sales rep profile is the one LSC Mobile is published for, so it beats a bigger generic profile.
  const field = rep.filter((p) => /field sales rep/i.test(p.name));
  return [...(field.length ? field : rep)].sort((a, b) => b.users - a.users || a.name.localeCompare(b.name))[0]?.name ?? null;
}
