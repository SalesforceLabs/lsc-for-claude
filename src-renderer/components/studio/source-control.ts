/**
 * Source control for orgs deployed from Git: which applied changes have a source
 * file to save ("Save as source files…", `studio_export_source`) and which live
 * only in the org. Copy of `orgOnlyReason` in `src/studio/source-export.ts`, kept
 * equal by `test/unit/studio/source-export.test.ts`.
 */

import type { StudioFix } from "./types";

export const SOURCE_CONTROL_HINT =
  "Turn on if this org is deployed from Git (sfdx). Studio will remind you to save changes as source files so the next deploy doesn't undo them.";

export const SOURCE_WARNING =
  "This org is deployed from source control. Save these as source files after applying, or the next deploy will undo them.";

const ORG_ONLY = {
  psl: "Permission set license assignments are user records in the org, not source files.",
  access: "Permission set, group and territory assignments are user records in the org, not source files.",
  script: "Custom scripts are records in the org (LifeScienceCustomScript); they have no source file.",
  handler: "Trigger handlers are switched on and off in the org; they have no source file.",
} as const;

/** Why a change has no source file, or null when it has one. */
export function orgOnlyReason(fix: StudioFix): string | null {
  switch (fix.kind) {
    case "assignPsl":
    case "removePsl":
      return ORG_ONLY.psl;
    case "assignAccess":
    case "removeAccess":
      return ORG_ONLY.access;
    case "setCustomScriptCode":
      return ORG_ONLY.script;
    case "setActive":
      return fix.record.type === "triggerHandler" ? ORG_ONLY.handler : null;
    default:
      return null;
  }
}

/** The "Org only" label for a change row, with why as its tooltip; null when it has a source file. */
export function orgOnlyLabel(fix: StudioFix): { label: "Org only"; title: string } | null {
  const why = orgOnlyReason(fix);
  return why ? { label: "Org only", title: why } : null;
}

/** Changes that go into source files. */
export const sourceChanges = (fixes: StudioFix[]): StudioFix[] => fixes.filter((f) => !orgOnlyReason(f));

/** What `studio_export_source` returns (a structural copy of `SourceExportResult`). */
export interface SourceExportResult {
  folder: string;
  packageDir: string;
  manifest: string | null;
  files: { type: string; fullName: string; path: string; status: "written" | "merged" | "partial" }[];
  toRemove: { type: string; fullName: string; path: string; exists: boolean }[];
  orgOnly: { label: string; why: string }[];
  missing: { type: string; fullName: string }[];
  notes: string[];
}

/** "Saved 3 files to ~/proj" style summary. */
export function savedSummary(result: SourceExportResult): string {
  const n = result.files.length;
  const folder = result.folder.replace(/^\/Users\/[^/]+/, "~");
  return n === 0 ? `Nothing to save in ${folder}` : `Saved ${n} ${n === 1 ? "file" : "files"} to ${folder}`;
}
