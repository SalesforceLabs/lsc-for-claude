/**
 * What the app's updater is doing, as the renderer shows it. Kept free of Electron so it can be tested;
 * the updater itself is `updater.ts`.
 */
export type UpdateState =
  /** This copy can't update itself (a dev build, not macOS, or run from the disk image). */
  | { status: "unsupported"; version: string; reason: string }
  /** Nothing to do. `checkedAt` is set once a check found no newer version. */
  | { status: "idle"; version: string; checkedAt?: number }
  | { status: "checking"; version: string }
  | { status: "downloading"; version: string; next: string; percent: number }
  /** Downloaded; installs on quit, or now with Restart to update. */
  | { status: "ready"; version: string; next: string }
  | { status: "error"; version: string; message: string };

/** First check after launch, once startup's own work is done. */
export const FIRST_CHECK_DELAY_MS = 30_000;
/** Then this often while the app stays open. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;

/**
 * Why this copy can't update itself, or null when it can. Only the Mac app has an update feed
 * (`latest-mac.yml`). Squirrel can't replace an app that runs from the mounted disk image or from
 * macOS's App Translocation copy (an app opened from Downloads before it was moved).
 */
export function updateBlocker(opts: { packaged: boolean; platform: string; appPath: string; disabled?: boolean }): string | null {
  if (opts.disabled) return "Updates are turned off for this copy (ROZ_UPDATES=0).";
  if (!opts.packaged) return "Updates only run in the installed app.";
  if (opts.platform !== "darwin") return "Automatic updates are only available on macOS.";
  if (opts.appPath.startsWith("/Volumes/") || opts.appPath.includes("/AppTranslocation/")) {
    return "Move Roz for LSC to your Applications folder to get updates.";
  }
  return null;
}

/** A plain message for a failed check or download. */
export function updateErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ERR_CONNECTION|net::/i.test(text)) {
    return "Couldn't reach GitHub to check for updates.";
  }
  if (/code signature|signature.*(valid|match)|not signed/i.test(text)) {
    return "The update's signature didn't match this app, so it wasn't installed.";
  }
  // electron-updater errors can carry a whole HTTP response; the first line says what went wrong.
  const first = text.split("\n")[0].trim();
  return first.length > 200 ? `${first.slice(0, 199)}…` : first || "The update check failed.";
}
