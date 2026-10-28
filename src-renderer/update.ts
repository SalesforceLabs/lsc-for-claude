/** Renderer copy of UpdateState in src-electron/update-state.ts, and how Settings words it. */
export type UpdateState =
  | { status: "unsupported"; version: string; reason: string }
  | { status: "idle"; version: string; checkedAt?: number }
  | { status: "checking"; version: string }
  | { status: "downloading"; version: string; next: string; percent: number }
  | { status: "ready"; version: string; next: string }
  | { status: "error"; version: string; message: string };

/** One line under the version in Settings. */
export function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case "unsupported":
      return state.reason;
    case "idle":
      return state.checkedAt
        ? `Up to date. Checked at ${new Date(state.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`
        : "Roz checks for updates on its own and downloads them in the background.";
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return `Downloading version ${state.next}… ${state.percent}%`;
    case "ready":
      return `Version ${state.next} is ready. It installs the next time you quit Roz, or restart now.`;
    case "error":
      return state.message;
  }
}

/** Whether Check for updates can run now. */
export function canCheckForUpdates(state: UpdateState): boolean {
  return state.status === "idle" || state.status === "error";
}
