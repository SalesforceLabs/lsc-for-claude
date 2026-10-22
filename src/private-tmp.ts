import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let root: string | undefined;

/** Whether `dir` is a real folder (not a link) that only this user can open. */
function ours(dir: string): boolean {
  try {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    if (process.platform === "win32") return true;
    return st.uid === process.getuid?.() && (st.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/** This user's temp folder: `lsc-<uid>`, kept across runs so disk caches survive a restart. */
function userRoot(): string {
  if (root && ours(root)) return root;
  const id = process.getuid?.() ?? os.userInfo().username.replace(/[^\w.-]/g, "_");
  const stable = path.join(os.tmpdir(), `lsc-${id}`);
  try {
    fs.mkdirSync(stable, { mode: 0o700 });
  } catch {
    // Already there: used only if it passes the check below.
  }
  // Someone else made it (or it's a link): a fresh random folder instead, losing only the caches.
  root = ours(stable) ? stable : fs.mkdtempSync(path.join(os.tmpdir(), "lsc-"));
  return root;
}

/**
 * A folder under this user's private temp folder. On a shared /tmp, folders with fixed names could be
 * made first by another user, who could then swap the files this server writes and deploys, compiles,
 * runs or reads back as cache. The parent is only used when this user owns it with mode 0700.
 */
export function privateTmp(...parts: string[]): string {
  const dir = path.join(userRoot(), ...parts);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
