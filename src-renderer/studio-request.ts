/** Where chat (or any other view) asks Studio to open: `App.openStudio(request)`. */
export type StudioRequest =
  /** Open Studio and the review dialog for the tray. */
  | { kind: "review" }
  | { kind: "setup"; featureId: string; surface?: string; item?: string }
  | { kind: "sync-rep"; userId: string }
  | { kind: "overview" }
  /** A rail section by id, e.g. "drift", "preview", "metadata-cache", "object-sync", "custom-scripts". */
  | { kind: "section"; section: string };
