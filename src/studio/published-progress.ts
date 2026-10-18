/**
 * Progress of a running `loadPublishedIpad`, so Studio can show which step a
 * slow load is on (studio_ipad_published_progress). One entry per profile;
 * a new load of the profile replaces it.
 */

export type LoadStepState = "waiting" | "running" | "done" | "failed";

export interface LoadStep {
  key: LoadStepKey;
  label: string;
  state: LoadStepState;
  /** Partial progress while running ("12 of 40 list views"), or why a step was cut short. */
  detail?: string;
  /** When the step began and ended, for per-step times. */
  startedAt?: number;
  endedAt?: number;
}

export interface LoadProgress {
  profile: string;
  startedAt: number;
  finishedAt?: number;
  steps: LoadStep[];
}

const LABELS = {
  cache: "Finding the published metadata cache",
  download: "Downloading the metadata cache",
  unpack: "Unpacking tabs, layouts and pages",
  access: "Checking object access",
  build: "Building the iPad for each permission set combination",
  sharing: "Reading the user's roles, territories and groups",
  reports: "Reading reports",
  lists: "Running list views",
  screens: "Collecting Home, Accounts, Calendar and other screens",
  records: "Reading the records screens open",
  dashboards: "Reading dashboards",
} as const;

export type LoadStepKey = keyof typeof LABELS;

const runs = new Map<string, LoadProgress>();

export class LoadTracker {
  readonly progress: LoadProgress;

  constructor(profile: string) {
    this.progress = { profile, startedAt: Date.now(), steps: [] };
    runs.set(profile, this.progress);
  }

  /** Add steps that will run, so the bar knows the total before they start. */
  plan(keys: LoadStepKey[]): void {
    for (const key of keys) if (!this.find(key)) this.progress.steps.push({ key, label: LABELS[key], state: "waiting" });
  }

  /** Run one step, marking it running, then done or failed. */
  async run<T>(key: LoadStepKey, fn: () => Promise<T>): Promise<T> {
    this.plan([key]);
    const step = this.find(key) as LoadStep;
    step.state = "running";
    step.startedAt = Date.now();
    try {
      const value = await fn();
      step.state = "done";
      return value;
    } catch (err) {
      step.state = "failed";
      throw err;
    } finally {
      step.endedAt = Date.now();
    }
  }

  /** Say how far a step is, so a slow one shows partial progress. */
  detail(key: LoadStepKey, text: string): void {
    const step = this.find(key);
    if (step) step.detail = text;
  }

  /** The load returned: steps it skipped (cached, or no viewer) drop out. */
  finish(): void {
    this.progress.steps = this.progress.steps.filter((s) => s.state !== "waiting");
    this.progress.finishedAt = Date.now();
  }

  private find(key: LoadStepKey): LoadStep | undefined {
    return this.progress.steps.find((s) => s.key === key);
  }
}

export function loadProgress(profile: string): LoadProgress | null {
  return runs.get(profile) ?? null;
}
