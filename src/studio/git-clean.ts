import { execFile } from "child_process";
import { createHash } from "crypto";

/**
 * Whether replacing a file in the user's sfdx project loses anything. The same rule as the
 * Electron app's `src-electron/source-files.ts` (kept equal by a test): a file is safe to
 * replace when Git has it committed with no edits since, or when it's what Studio last wrote
 * there (its hash, passed in by the app). Git is only read, never written.
 */

export const hashText = (s: string | Buffer): string => createHash("sha1").update(s).digest("hex");

const git = (folder: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", folder, "--literal-pathspecs", ...args],
      { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });

/** Paths (relative to `folder`, "/"-separated) Git has committed with no edits in the working tree; empty outside a repository. */
export async function cleanInGit(folder: string, rels: string[]): Promise<Set<string>> {
  if (rels.length === 0) return new Set();
  // Both list paths relative to the folder (-C), unlike `git status`, which lists them from the repository root.
  const tracked = await git(folder, ["ls-files", "-z", "--", ...rels]);
  if (tracked === null) return new Set();
  const modified = (await git(folder, ["ls-files", "-z", "-m", "--", ...rels])) ?? tracked;
  const dirty = new Set(modified.split("\0").filter(Boolean));
  return new Set(tracked.split("\0").filter((p) => p && !dirty.has(p)));
}
