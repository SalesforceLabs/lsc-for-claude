import { execFileSync } from "child_process";
import os from "os";
import path from "path";

/**
 * A Mac app opened from Finder or the Dock gets launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), so it
 * can't find an sf CLI installed with Homebrew, npm or nvm, nor the Node an npm-installed sf runs on.
 * Started from a terminal it has the terminal's PATH. This adds the login shell's PATH, then the usual
 * install folders, after what's already there; nothing already on PATH moves.
 */
export function withShellPath(env: NodeJS.ProcessEnv = process.env, readShellPath: () => string | undefined = loginShellPath): string {
  const current = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  const extra = [
    ...(readShellPath()?.split(path.delimiter) ?? []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".volta", "bin"),
  ];
  const seen = new Set(current);
  for (const dir of extra) {
    if (dir && path.isAbsolute(dir) && !seen.has(dir)) {
      seen.add(dir);
      current.push(dir);
    }
  }
  return current.join(path.delimiter);
}

const MARK = "__LSC_PATH__";

/** PATH as the user's login shell sets it (rc files print banners, so it's read between marks), or undefined. */
export function loginShellPath(): string | undefined {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const out = execFileSync(shell, ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
    });
    return out.split(MARK)[1] || undefined;
  } catch {
    return undefined;
  }
}

/** On a packaged Mac or Linux app, PATH gets the login shell's folders before anything runs sf. */
export function fixPathForPackagedApp(isPackaged: boolean): void {
  if (!isPackaged || process.platform === "win32") return;
  process.env.PATH = withShellPath();
}
