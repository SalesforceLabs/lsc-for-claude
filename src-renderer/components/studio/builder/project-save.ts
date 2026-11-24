import { versionNumber } from "./logic";
import type { AppProject } from "./types";

/**
 * Where an app stands in the org's sfdx project (Settings → Deployed from source control),
 * for the builder header. Main writes each new current version there on its own
 * (`src-electron/engine/app-folder.ts`); this only reads the result.
 */
export type ProjectSave =
  | { kind: "off" }
  /** Source control is on but no folder is chosen yet. */
  | { kind: "no-folder" }
  | { kind: "saved"; version: number; title: string }
  | { kind: "unsaved"; version: number }
  | { kind: "conflict"; version: number; files: string[] }
  | { kind: "error"; message: string };

export function projectSave(project: AppProject, sc: { deployed: boolean; folder?: string }): ProjectSave {
  if (!sc.deployed || project.versions.length === 0) return { kind: "off" };
  if (!sc.folder) return { kind: "no-folder" };
  const current = versionNumber(project, project.currentVersionId);
  const link = project.folder?.path === sc.folder ? project.folder : undefined;
  if (link?.conflict) return { kind: "conflict", version: versionNumber(project, link.conflict.versionId) || current, files: link.conflict.files };
  if (link?.error) return { kind: "error", message: link.error };
  if (link?.savedVersionId && link.savedVersionId === project.currentVersionId)
    return { kind: "saved", version: current, title: `v${current} is in ${sc.folder.replace(/^\/Users\/[^/]+/, "~")}` };
  return { kind: "unsaved", version: current };
}

/** The conflict's explanation, naming at most five files. */
export function conflictText(files: string[]): string {
  const names = files.map((f) => f.split("/").slice(-2).join("/"));
  const shown = names.slice(0, 5).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
  const one = files.length === 1;
  return `${one ? "This file was" : "These files were"} edited in your project and not committed: ${shown}. Replace ${one ? "it" : "them"} with this version, or keep yours.`;
}

/** Deployed components (`Type:Name`) that go into the project as source files beside the app's bundles. */
const EXPORTABLE = new Set(["QuickAction", "FlexiPage", "CustomTab", "CustomApplication"]);

/**
 * What a deploy wrote besides the LWC bundles (which the builder saves itself), as
 * `studio_export_source` items. Profiles are left out: Studio merges only layout
 * assignments into a profile file, so tab visibility is named as a note instead.
 */
export function deployExtras(deployed: string[]): { items: { type: string; fullName: string }[]; profiles: string[] } {
  const items: { type: string; fullName: string }[] = [];
  const profiles: string[] = [];
  for (const d of deployed) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    const type = d.slice(0, i);
    const fullName = d.slice(i + 1);
    if (EXPORTABLE.has(type)) items.push({ type, fullName });
    else if (type === "Profile") profiles.push(fullName);
  }
  return { items, profiles };
}
