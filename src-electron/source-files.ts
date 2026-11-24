import { execFile } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

/**
 * What Studio knows about the files it writes into an org's sfdx project, shared by
 * the LSC app builder (each version's LWC bundles) and **Save as source files…**.
 *
 * A file in the project is only replaced when that loses nothing: Git has it committed
 * with no edits since, or it's exactly what Studio last wrote there (hash kept here).
 * Anything else — an uncommitted edit, a file Studio has never written that differs —
 * is a conflict for the user to settle. Studio only reads Git (`ls-files`); it never
 * stages, commits or changes branches.
 */

export const hashText = (s: string | Buffer): string => createHash("sha1").update(s).digest("hex");

/** Hashes of the files Studio last wrote, by project folder, then path relative to it ("force-app/main/default/…"). */
export interface SourceHashStore {
  get(folder: string): Record<string, string>;
  /** Record files written (path → hash) and forget `removed`. */
  update(folder: string, written: Record<string, string>, removed?: string[]): void;
}

/** A store kept in one JSON file (userData `source-files.json` in the app). */
export function fileHashStore(file: string): SourceHashStore {
  const read = (): Record<string, Record<string, string>> => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  };
  return {
    get: (folder) => ({ ...(read()[path.resolve(folder)] ?? {}) }),
    update(folder, written, removed = []) {
      const all = read();
      const key = path.resolve(folder);
      const next = { ...(all[key] ?? {}), ...written };
      for (const r of removed) delete next[r];
      all[key] = next;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all));
    },
  };
}

export function memoryHashStore(): SourceHashStore {
  const all = new Map<string, Record<string, string>>();
  return {
    get: (folder) => ({ ...(all.get(path.resolve(folder)) ?? {}) }),
    update(folder, written, removed = []) {
      const next = { ...(all.get(path.resolve(folder)) ?? {}), ...written };
      for (const r of removed) delete next[r];
      all.set(path.resolve(folder), next);
    },
  };
}

const git = (folder: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", folder, "--literal-pathspecs", ...args],
      { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });

/**
 * The paths (relative to `folder`, "/"-separated) that Git has committed with no edits in the
 * working tree, so replacing them loses nothing. Empty when the folder isn't in a Git repository
 * or Git isn't installed.
 */
export async function cleanInGit(folder: string, rels: string[]): Promise<Set<string>> {
  if (rels.length === 0) return new Set();
  // Both list paths relative to the folder (-C), unlike `git status`, which lists them from the repository root.
  const tracked = await git(folder, ["ls-files", "-z", "--", ...rels]);
  if (tracked === null) return new Set();
  const modified = (await git(folder, ["ls-files", "-z", "-m", "--", ...rels])) ?? tracked;
  const dirty = new Set(modified.split("\0").filter(Boolean));
  return new Set(tracked.split("\0").filter((p) => p && !dirty.has(p)));
}

/** The Git branch the folder is on, for showing beside the folder; null outside a repository. */
export async function gitBranch(folder: string): Promise<string | null> {
  const out = await git(folder, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return out?.trim() || null;
}
