import fs from "fs";
import path from "path";
import { cleanInGit, hashText, type SourceHashStore } from "../source-files.js";
import type { AppFile, AppFolderLink } from "./app-types.js";

/**
 * An LSC app's bundles in the org's sfdx project (Settings → Deployed from source control).
 * Each version that becomes current is mirrored into the project's default package,
 * `<package>/main/default/lwc/<bundle>/`, so the team's Git sees every change before
 * anything is deployed. Nothing outside the app's own bundle folders is touched.
 *
 * A file is replaced only when that loses nothing (`source-files.ts`): Git has it committed
 * and unedited, or it's what Studio last wrote. Otherwise the version isn't saved and the
 * files are listed as a conflict until the user replaces them. Files Studio wrote that a
 * later version drops are deleted the same way; files Studio never wrote (tests, the
 * team's own additions) stay.
 */

const BUNDLE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Why `folder` can't be the org's project, or null when it's an sfdx project. */
export function folderProblem(folder: string): string | null {
  if (!path.isAbsolute(folder)) return "Choose a folder on this computer.";
  if (!fs.existsSync(path.join(folder, "sfdx-project.json")))
    return "That folder isn't an sfdx project. Choose the folder that has sfdx-project.json in it.";
  try {
    packageRoot(folder);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

/** `<default package>/main/default` of an sfdx project (the same rule as src/studio/source-export.ts). */
export function packageRoot(folder: string): string {
  let project: { packageDirectories?: { path?: string; default?: boolean }[] };
  try {
    project = JSON.parse(fs.readFileSync(path.join(folder, "sfdx-project.json"), "utf-8"));
  } catch {
    throw new Error("sfdx-project.json in that folder couldn't be read.");
  }
  const dirs = project.packageDirectories ?? [];
  const pkg = (dirs.find((d) => d.default) ?? dirs[0])?.path || "force-app";
  const base = path.resolve(folder);
  const root = path.resolve(base, pkg, "main", "default");
  if (!root.startsWith(base + path.sep)) throw new Error("The project's package folder is outside the project.");
  return root;
}

/** Where an app file (`lwc/<bundle>/<file>`) goes, or null for a path that would leave its bundle. */
function destination(root: string, file: AppFile): string | null {
  const parts = file.path.split("/");
  if (parts.length < 3 || parts[0] !== "lwc" || parts[1] !== file.bundle || !BUNDLE.test(file.bundle)) return null;
  if (parts.slice(2).some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return null;
  const bundleDir = path.join(root, "lwc", file.bundle);
  const dest = path.resolve(bundleDir, ...parts.slice(2));
  return dest.startsWith(bundleDir + path.sep) ? dest : null;
}

const readText = (p: string): string | null => {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

export interface FolderWriteResult {
  link: AppFolderLink;
  written: number;
  deleted: number;
}

/**
 * Write one version's `files` into the project at `folder`. With conflicts and no `force`,
 * writes nothing and lists them on the link; with `force`, replaces them.
 */
export async function writeToFolder(
  folder: string,
  files: AppFile[],
  versionId: string,
  opts: { hashes: SourceHashStore; previous?: AppFolderLink; force?: boolean; now?: string }
): Promise<FolderWriteResult> {
  const now = opts.now ?? new Date().toISOString();
  const prev = opts.previous?.path === folder ? opts.previous : undefined;
  const base: AppFolderLink = { path: folder, ...(prev?.savedVersionId ? { savedVersionId: prev.savedVersionId, savedAt: prev.savedAt } : {}) };
  const fail = (error: string): FolderWriteResult => ({ link: { ...base, error }, written: 0, deleted: 0 });

  const problem = folderProblem(folder);
  if (problem) return fail(problem);
  const root = packageRoot(folder);
  const rel = (abs: string) => path.relative(folder, abs).split(path.sep).join("/");

  const plan: { abs: string; rel: string; source: string }[] = [];
  for (const f of files) {
    const abs = destination(root, f);
    if (!abs) return fail(`Studio won't write ${f.path}: it isn't inside its bundle folder.`);
    plan.push({ abs, rel: rel(abs), source: f.source });
  }
  const keep = new Set(plan.map((p) => p.rel));
  const bundlePrefixes = [...new Set(files.map((f) => rel(path.join(root, "lwc", f.bundle)) + "/"))];
  const known = opts.hashes.get(folder);
  // Files Studio wrote in these bundles that this version doesn't have.
  const dropped = Object.keys(known).filter((r) => !keep.has(r) && bundlePrefixes.some((b) => r.startsWith(b)));

  const changing = plan.filter((p) => {
    const onDisk = readText(p.abs);
    return onDisk !== null && onDisk !== p.source && known[p.rel] !== hashText(onDisk);
  });
  const clean = await cleanInGit(folder, changing.map((p) => p.rel));
  const conflicts = changing.filter((p) => !clean.has(p.rel)).map((p) => p.rel);
  if (conflicts.length && !opts.force) return { link: { ...base, conflict: { versionId, files: conflicts.sort() } }, written: 0, deleted: 0 };

  const written: Record<string, string> = {};
  const removed: string[] = [];
  let count = 0;
  let deleted = 0;
  try {
    for (const p of plan) {
      if (readText(p.abs) !== p.source) {
        fs.mkdirSync(path.dirname(p.abs), { recursive: true });
        fs.writeFileSync(p.abs, p.source, "utf-8");
        count++;
      }
      written[p.rel] = hashText(p.source);
    }
    for (const r of dropped) {
      const abs = path.resolve(folder, ...r.split("/"));
      const onDisk = readText(abs);
      // Edited since Studio wrote it: the team's file now; leave it.
      if (onDisk !== null && hashText(onDisk) === known[r] && abs.startsWith(root + path.sep)) {
        fs.rmSync(abs);
        deleted++;
      }
      removed.push(r);
    }
  } catch (e) {
    opts.hashes.update(folder, written);
    return fail(`Couldn't write to the project: ${e instanceof Error ? e.message : String(e)}`);
  }
  opts.hashes.update(folder, written, removed);
  return { link: { path: folder, savedVersionId: versionId, savedAt: now }, written: count, deleted };
}
