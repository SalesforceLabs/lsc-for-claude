/**
 * Source control for orgs deployed from Git: which applied changes have a source
 * file to save ("Save as source files…", `studio_export_source`) and which live
 * only in the org. Copy of `orgOnlyReason` in `src/studio/source-export.ts`, kept
 * equal by `test/unit/studio/source-export.test.ts`.
 */

import type { StudioFix } from "./types";

export const SOURCE_CONTROL_HINT =
  "Turn on if this org is deployed from Git (sfdx). Studio saves changes you apply and the LSC apps you build into the project folder, so they go through your team's Git before the next deploy. Files edited in the project are never replaced without asking.";

/** "~/proj" for a folder under the home folder. */
export const shortPath = (folder: string): string => folder.replace(/^\/Users\/[^/]+/, "~");

export const SOURCE_WARNING =
  "This org is deployed from source control. Save these as source files after applying, or the next deploy will undo them.";

const ORG_ONLY = {
  psl: "Permission set license assignments are user records in the org, not source files.",
  access:
    "Permission set, group and territory assignments are user records in the org, not source files.",
  script:
    "Custom scripts are records in the org (LifeScienceCustomScript); they have no source file.",
  handler: "Trigger handlers are switched on and off in the org; they have no source file.",
  content:
    "Presentations, their pages, topics and territories are records in the org; they have no source file.",
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
    case "editPresentation":
    case "createPresentation":
    case "deletePresentation":
      return ORG_ONLY.content;
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
export const sourceChanges = (fixes: StudioFix[]): StudioFix[] =>
  fixes.filter((f) => !orgOnlyReason(f));

/**
 * The source documents the changes touch ("Layout:Visit-Visit Layout"), for "N files" before
 * anything is retrieved — `planSourceExport`'s items, validation rules by Id. Apps that assign
 * a copied Lightning page are found only at export, so they aren't counted.
 */
export function sourceDocs(fixes: StudioFix[]): string[] {
  const docs = new Set<string>();
  for (const fix of sourceChanges(fixes)) {
    switch (fix.kind) {
      case "editMetadata":
        docs.add(`${fix.doc.type}:${fix.doc.fullName}`);
        break;
      case "setLayoutRelatedList":
        docs.add(`Layout:${fix.layoutName}`);
        break;
      case "copyForProfile":
        docs.add(`${fix.doc.type}:${fix.copy.fullName}`);
        if (fix.doc.type === "Layout") {
          docs.add(`Layout:${fix.doc.fullName}`);
          docs.add(`Profile:${fix.profile}`);
        }
        break;
      case "setConfigField":
      case "setProfileAssignments":
      case "createConfigRecord":
      case "deleteConfigRecord":
        docs.add(`LifeSciConfigRecord:${fix.developerName}`);
        break;
      case "setActive":
        if (fix.record.type === "config")
          docs.add(`LifeSciConfigRecord:${fix.record.developerName}`);
        else if (fix.record.type === "validationRule") docs.add(`ValidationRule:${fix.record.id}`);
        break;
    }
  }
  return [...docs];
}

/**
 * After an undo succeeds the documents it restored are back to how they were before the apply, so
 * nothing is left to save for them: drop the applied fixes whose documents were all restored. Fixes
 * that touch other documents too (partial undos) stay.
 */
export function withoutUndone(applied: StudioFix[], undone: StudioFix[]): StudioFix[] {
  const restored = new Set(sourceDocs(undone));
  if (restored.size === 0) return applied;
  return applied.filter((f) => {
    const docs = sourceDocs([f]);
    return docs.length === 0 || !docs.every((d) => restored.has(d));
  });
}

/** What `studio_export_source` returns (a structural copy of `SourceExportResult`). */
export interface SourceExportResult {
  folder: string;
  packageDir: string;
  manifest: string | null;
  files: {
    type: string;
    fullName: string;
    path: string;
    status: "written" | "merged" | "partial";
  }[];
  toRemove: { type: string; fullName: string; path: string; exists: boolean }[];
  orgOnly: { label: string; why: string }[];
  missing: { type: string; fullName: string }[];
  notes: string[];
  /** Files edited in the project that weren't replaced (paths relative to `folder`). */
  conflicts: { type: string; fullName: string; path: string }[];
  /** What was written, path → sha1 (recorded by the main process). */
  hashes: Record<string, string>;
}

const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

/** "Saved 3 files to ~/proj" style summary. */
export function savedSummary(result: SourceExportResult): string {
  const n = result.files.length;
  const c = result.conflicts?.length ?? 0;
  const folder = shortPath(result.folder);
  if (c > 0)
    return n === 0
      ? `${files(c)} changed in ${folder}`
      : `Saved ${files(n)} to ${folder}, ${c} changed there`;
  return n === 0 ? `Nothing to save in ${folder}` : `Saved ${files(n)} to ${folder}`;
}

/** Why some files weren't saved, for the conflict step. */
export function conflictDetail(result: SourceExportResult): string {
  const paths = (result.conflicts ?? []).map((c) => c.path);
  const shown = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? ` and ${paths.length - 5} more` : "";
  return `${paths.length === 1 ? "This file has" : "These files have"} edits in your project that aren't committed or weren't made by Studio: ${shown}${more}. Replace them with the org's version, or keep yours.`;
}
