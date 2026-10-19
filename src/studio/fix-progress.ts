/**
 * Live progress of a Studio change being previewed or applied, so the review
 * dialog can say which step each change is on (studio_fix_progress). The
 * renderer passes a `progress` id (one per preview or apply batch) with the
 * change's index and the batch size; every change is one entry under that id.
 * Entries are dropped a couple of minutes after the batch's last change ends.
 *
 * Nothing here is global state a job could mix up: each change holds its own
 * FixTracker, and code that doesn't care passes none (every helper accepts
 * `undefined`).
 */

import type { MetadataStatus } from "../salesforce/direct-metadata.js";
import type { StudioFix } from "./types.js";

export type FixStepState = "waiting" | "running" | "done" | "failed";

export interface FixStep {
  key: string;
  label: string;
  state: FixStepState;
  /** Partial progress while running ("2 of 3 components"), or what Salesforce says it is doing. */
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface ChangeProgress {
  /** Position in the batch (0-based) and the batch's size, for "Change 2 of 3". */
  index: number;
  total: number;
  label: string;
  phase: "preview" | "apply";
  startedAt: number;
  finishedAt?: number;
  steps: FixStep[];
}

export interface FixProgress {
  id: string;
  startedAt: number;
  /** Set once every change of the batch has ended. */
  finishedAt?: number;
  changes: ChangeProgress[];
}

export interface ProgressArg {
  id: string;
  index: number;
  total: number;
}

export interface PlannedStep {
  key: string;
  label: string;
}

/** How long a finished batch stays readable, so the last poll can see it end. */
export const KEEP_FINISHED_MS = 2 * 60_000;
/** A batch nobody finished (a crashed call) is dropped after this long. */
const KEEP_STALE_MS = 30 * 60_000;
const MAX_ENTRIES = 50;

const runs = new Map<string, FixProgress>();

function prune(now = Date.now()): void {
  for (const [id, p] of runs) {
    const stale = p.finishedAt ? now - p.finishedAt > KEEP_FINISHED_MS : now - p.startedAt > KEEP_STALE_MS;
    if (stale) runs.delete(id);
  }
  // Oldest first (Map keeps insertion order).
  while (runs.size > MAX_ENTRIES) runs.delete(runs.keys().next().value as string);
}

export class FixTracker {
  constructor(
    private readonly batch: FixProgress,
    readonly change: ChangeProgress
  ) {}

  /** Add steps that may run, so the bar knows the total before they start. */
  plan(steps: PlannedStep[]): void {
    for (const s of steps) if (!this.find(s.key)) this.change.steps.push({ key: s.key, label: s.label, state: "waiting" });
  }

  /** Run one step, marking it running, then done or failed. A key that wasn't planned just runs. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const step = this.find(key);
    if (!step) return fn();
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

  /** For a stretch of code with early returns: mark a step running now, and done with `end`. Safe to call twice. */
  begin(key: string): void {
    const step = this.find(key);
    if (step && step.state === "waiting") {
      step.state = "running";
      step.startedAt = Date.now();
    }
  }

  end(key: string): void {
    const step = this.find(key);
    if (step && step.state === "running") {
      step.state = "done";
      step.endedAt = Date.now();
    }
  }

  /** Mark a step failed (for code that used `begin`). */
  fail(key: string): void {
    const step = this.find(key);
    if (step && step.state === "running") {
      step.state = "failed";
      step.endedAt = Date.now();
    }
  }

  /** Say how far a step is ("2 of 3 profiles"). */
  detail(key: string, text: string | undefined): void {
    const step = this.find(key);
    if (step) step.detail = text;
  }

  /** A hook for a metadata retrieve or deploy that reports Salesforce's own status on `key`. */
  statusHook(key: string): (status: MetadataStatus) => void {
    return (status) => this.detail(key, statusDetail(status));
  }

  /** The change returned: steps it skipped drop out, and the batch ends with its last change. */
  finish(): void {
    const c = this.change;
    // A step left running by an early return ended with the change.
    for (const s of c.steps) if (s.state === "running") this.end(s.key);
    c.steps = c.steps.filter((s) => s.state !== "waiting");
    c.finishedAt = Date.now();
    const all = this.batch.changes;
    this.batch.finishedAt = all.length >= c.total && all.every((x) => x.finishedAt) ? c.finishedAt : undefined;
  }

  private find(key: string): FixStep | undefined {
    return this.change.steps.find((s) => s.key === key);
  }
}

/** Run a step when there is a tracker; otherwise just run it. */
export function step<T>(progress: FixTracker | undefined, key: string, fn: () => Promise<T>): Promise<T> {
  return progress ? progress.run(key, fn) : fn();
}

/** "2 of 5 components" plus what Salesforce says it is doing. */
export function statusDetail(s: MetadataStatus): string {
  const parts: string[] = [];
  if (s.componentsTotal && s.componentsTotal > 0) parts.push(`${s.componentsDone ?? 0} of ${s.componentsTotal} components`);
  if (s.status) parts.push(`Salesforce: ${s.status.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`);
  if (s.stateDetail) parts.push(s.stateDetail);
  return parts.join(" · ");
}

/** Begin tracking one change of a batch; replaces an earlier entry for the same index (a retry). */
export function startFixChange(arg: ProgressArg, fix: StudioFix, phase: "preview" | "apply"): FixTracker {
  prune();
  let batch = runs.get(arg.id);
  if (!batch) {
    batch = { id: arg.id, startedAt: Date.now(), changes: [] };
    runs.set(arg.id, batch);
  }
  batch.finishedAt = undefined;
  const change: ChangeProgress = { index: arg.index, total: arg.total, label: fix.label, phase, startedAt: Date.now(), steps: [] };
  batch.changes = [...batch.changes.filter((c) => c.index !== arg.index), change].sort((a, b) => a.index - b.index);
  const tracker = new FixTracker(batch, change);
  tracker.plan(planFixSteps(fix, phase));
  return tracker;
}

export function fixProgress(id: string): FixProgress | null {
  prune();
  return runs.get(id) ?? null;
}

// --- The steps each kind of change goes through ---------------------------------------------

/**
 * The steps a change will take, named after the change. Steps a change turns out not to need
 * (a blocked change stops early) are dropped when it finishes. Keys are what the code passes to `step()`.
 */
export function planFixSteps(fix: StudioFix, phase: "preview" | "apply"): PlannedStep[] {
  const apply = phase === "apply";
  const write = (label: string): PlannedStep[] => (apply ? [{ key: "write", label }] : []);
  const read = (what: string): PlannedStep => ({ key: "read", label: apply ? `Re-checking ${what} hasn't changed` : `Reading ${what}` });
  switch (fix.kind) {
    case "assignPsl":
      return [{ key: "read", label: `${apply ? "Re-checking" : "Checking"} ${fix.userName}'s licenses and ${fix.pslLabel} capacity` }, ...write(`Assigning ${fix.pslLabel} to ${fix.userName}`)];
    case "removePsl":
      return [{ key: "read", label: `${apply ? "Re-checking" : "Checking"} ${fix.userName}'s ${fix.pslLabel} assignment` }, ...write(`Removing ${fix.pslLabel} from ${fix.userName}`)];
    case "setConfigField":
      return [
        read(`${fix.field} on ${fix.recordLabel}`),
        { key: "reach", label: `Checking which profiles ${fix.recordLabel} reaches` },
        ...write(`Updating ${fix.field} on ${fix.recordLabel}`),
      ];
    case "setProfileAssignments":
      return [
        read(`${fix.recordLabel}'s profile assignments`),
        { key: "reach", label: `Checking which profiles ${fix.recordLabel} reaches` },
        ...write(`Updating ${fix.recordLabel}'s profile assignments`),
      ];
    case "setActive":
      return [read(fix.record.label), ...write(`Switching ${fix.record.label} ${fix.to ? "on" : "off"}`)];
    case "createConfigRecord":
      return [
        { key: "read", label: `${apply ? "Re-checking" : "Checking"} ${fix.recordLabel} against the org` },
        { key: "reach", label: `Working out who will see ${fix.recordLabel}` },
        ...write(`Creating ${fix.recordLabel}`),
      ];
    case "deleteConfigRecord":
      return [
        read(fix.recordLabel),
        { key: "reach", label: `Working out who sees ${fix.recordLabel} today` },
        ...write(`Deleting ${fix.recordLabel}`),
      ];
    case "assignAccess":
    case "removeAccess":
      return [
        { key: "read", label: `${apply ? "Re-checking" : "Checking"} ${fix.userName}'s access` },
        ...write(`${fix.kind === "assignAccess" ? "Giving" : "Removing"} access for ${fix.userName}`),
      ];
    case "setCustomScriptCode":
      return [
        read(fix.scriptName),
        { key: "describe", label: "Checking the org lets the API write the script's code" },
        ...write(`Saving the code of ${fix.scriptName}`),
      ];
    case "setLayoutRelatedList":
      return [
        { key: "retrieve", label: `${apply ? "Re-reading" : "Reading"} ${fix.layoutLabel} from the org` },
        { key: "diff", label: `Building the change to ${fix.layoutLabel}` },
        ...(apply ? [{ key: "deploy", label: `Deploying ${fix.layoutLabel}` }] : []),
      ];
    case "editMetadata": {
      const label = fix.doc.label;
      const type = fix.doc.type;
      return [
        { key: "retrieve", label: `${apply ? "Re-reading" : "Reading"} ${label} from the org${apply ? " to check nothing changed" : ""}` },
        { key: "diff", label: `Building the diff for ${label}` },
        ...(type === "ListView" || apply
          ? []
          : [
              {
                key: "reach",
                label:
                  type === "FlexiPage"
                    ? `Finding the profiles and apps ${label} reaches (can take a minute)`
                    : type === "CompactLayout"
                      ? `Finding the record types ${label} reaches`
                      : `Finding the profiles ${label} reaches`,
              },
            ]),
        ...(apply ? [] : [{ key: "production", label: "Checking whether this is a production org" }]),
        ...(type === "Layout" && !apply ? [{ key: "validate", label: `Asking the org whether it would accept the change` }] : []),
        ...(apply ? [{ key: "deploy", label: `Deploying ${label}` }] : []),
      ];
    }
    case "copyForProfile": {
      const label = fix.doc.label;
      return [
        { key: "retrieve", label: `${apply ? "Re-reading" : "Reading"} ${label}${fix.doc.type === "Layout" ? " and the profile" : ""} from the org` },
        ...(fix.doc.type === "FlexiPage" ? [{ key: "apps", label: "Reading the apps that use it" }] : []),
        { key: "diff", label: `Planning the ${fix.revert ? "move back" : "copy"} for ${label}` },
        ...(apply ? [{ key: "deploy", label: `Deploying ${fix.revert ? "the change" : "the copy and the assignment"}` }] : []),
      ];
    }
  }
}
