import type { ScriptSummary, ScriptType } from "./script-model";

/** The order types are listed in: the one that runs for visits first. */
export const TYPE_ORDER: ScriptType[] = ["VisitActionValidation", "Validation", "Checklist"];

export const TYPE_LABEL: Record<ScriptType, string> = {
  VisitActionValidation: "Visit action validation",
  Validation: "Validation",
  Checklist: "Checklist",
};

/** One plain sentence per type, for the new-script dialog and empty states. */
export const TYPE_BLURB: Record<ScriptType, string> = {
  VisitActionValidation: "Checks a visit when the rep saves, signs or submits it. Only one runs per org.",
  Validation: "Checks a record when someone moves it through a workflow stage.",
  Checklist: "Shows a rep what's still missing on a workflow record, ahead of time.",
};

/** A row in the library: a script in the org, or one that exists only as a draft or a queued create. */
export interface LibraryRow {
  /** The script's id, or `new:<componentName>` for one not in the org yet. */
  key: string;
  name: string;
  componentName: string;
  type: ScriptType;
  /** Not in the org yet. */
  isNew: boolean;
  /** Has edits that aren't saved or queued. */
  dirty: boolean;
  /** Edits or a create are waiting in the tray. */
  queued: boolean;
  status: { tone: "pass" | "warning" | "error" | "info"; label: string; detail: string };
  summary?: ScriptSummary;
}

export interface LibraryGroup {
  type: ScriptType;
  label: string;
  rows: LibraryRow[];
}

export interface DraftRowInput {
  key: string;
  name: string;
  componentName: string;
  type: ScriptType;
  /** Has been queued in the tray. */
  queued: boolean;
}

export const NEW_STATUS = { tone: "info", label: "New", detail: "Not in the org yet." } as const;

/** Library rows: the org's scripts first (in the order the server sent), then drafts of scripts that don't exist yet. */
export function buildRows(
  scripts: readonly ScriptSummary[],
  drafts: readonly DraftRowInput[],
  dirtyKeys: ReadonlySet<string>,
  queuedKeys: ReadonlySet<string>
): LibraryRow[] {
  const known = new Set(scripts.map((s) => s.componentName.toLowerCase()));
  const org: LibraryRow[] = scripts.map((s) => ({
    key: s.id,
    name: s.name,
    componentName: s.componentName,
    type: s.type,
    isNew: false,
    dirty: dirtyKeys.has(s.id),
    queued: queuedKeys.has(s.id),
    status: s.status,
    summary: s,
  }));
  const fresh: LibraryRow[] = drafts
    .filter((d) => !known.has(d.componentName.toLowerCase()))
    .map((d) => ({
      key: d.key,
      name: d.name || d.componentName || "Untitled script",
      componentName: d.componentName,
      type: d.type,
      isNew: true,
      dirty: dirtyKeys.has(d.key) && !d.queued,
      queued: d.queued,
      status: NEW_STATUS,
    }));
  return [...org, ...fresh];
}

/** Whether a row matches the search words (name, component name, type, status and where it runs). */
export function rowMatches(row: LibraryRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [
    row.name,
    row.componentName,
    TYPE_LABEL[row.type],
    row.status.label,
    row.status.detail,
    ...(row.summary?.assignedTo.map((a) => `${a.stageObjectName} ${a.objectName}`) ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Rows grouped by type in `TYPE_ORDER`, each group sorted by name; groups with no rows are left out. */
export function groupRows(rows: readonly LibraryRow[], query = ""): LibraryGroup[] {
  const shown = rows.filter((r) => rowMatches(r, query));
  return TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABEL[type],
    rows: shown.filter((r) => r.type === type).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  })).filter((g) => g.rows.length > 0);
}

/** "3 scripts" / "1 script". */
export function countLabel(n: number, noun = "script"): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The Visit action validation scripts, oldest first, for the "only the first one runs" warning in the new-script dialog. */
export function existingVisitScripts(scripts: readonly ScriptSummary[]): ScriptSummary[] {
  return scripts.filter((s) => s.type === "VisitActionValidation").sort((a, b) => a.createdDate.localeCompare(b.createdDate));
}
