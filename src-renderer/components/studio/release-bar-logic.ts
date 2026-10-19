import type { PublishStatus } from "./types";
import { indicatorFor, type UnpublishedItem, type UnpublishedState } from "./org-ahead";
import { awaitsPublish, profilesToPublish } from "./reach";
import type { PendingChange } from "./changes";

/**
 * The release bar's middle step, "In the org": what was applied but isn't on iPads yet.
 * In the preview it is the profile's unpublished items (read from the org, all three async states);
 * elsewhere it is what this session applied that waits for a publish.
 */
export type OrgStep =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "neverPublished" }
  | { kind: "count"; count: number; incomplete: boolean; publishedAt?: string };

/** "In the org" for one profile, from its unpublished items: only those that wait for a publish count. */
export function profileOrgStep(state: UnpublishedState | undefined): OrgStep {
  const ind = indicatorFor(state);
  switch (ind.kind) {
    case "loading":
      return { kind: "loading" };
    case "error":
      return { kind: "error", message: ind.message };
    case "partial":
      return { kind: "error", message: `Couldn't read: ${ind.message}` };
    case "neverPublished":
      return { kind: "neverPublished" };
    case "upToDate":
      return { kind: "count", count: 0, incomplete: false, publishedAt: ind.publishedAt ?? undefined };
    case "changes": {
      const items = state?.status === "ready" ? state.result.items : [];
      return { kind: "count", count: items.filter(awaitsPublish).length, incomplete: ind.incomplete, publishedAt: ind.publishedAt ?? undefined };
    }
  }
}

/** The unpublished items that wait for a publish (list views and the like are already on iPads). */
export function itemsAwaitingPublish(items: UnpublishedItem[]): UnpublishedItem[] {
  return items.filter(awaitsPublish);
}

/** "In the org" for the whole session: applied changes that wait for a publish. */
export function sessionOrgStep(awaiting: PendingChange[]): OrgStep {
  return { kind: "count", count: awaiting.length, incomplete: false };
}

/** The bar's one next step. */
export type Primary =
  | { kind: "review"; count: number }
  | { kind: "publish"; profiles: string[] | null; label: string; title: string }
  | { kind: "publishing"; count: number }
  | { kind: "calm"; text: string; title: string }
  | { kind: "none" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface PrimaryInput {
  pending: number;
  org: OrgStep;
  /** The previewed profile; publishing is scoped to it. */
  profile: string | null;
  /** What this session applied that waits for a publish (every profile). */
  awaiting: PendingChange[];
  job: PublishStatus | null;
}

/**
 * Review the tray when it has changes; else publish when the org is ahead of the iPads (this profile in the
 * preview, the profiles the session's changes reach elsewhere); else a calm "Reps have everything".
 */
export function primaryAction({ pending, org, profile, awaiting, job }: PrimaryInput): Primary {
  if (pending > 0) return { kind: "review", count: pending };
  if (job?.state === "running") return { kind: "publishing", count: job.profiles.length };
  if (org.kind === "count" && org.count > 0) {
    // In the preview: this profile, plus every other profile the session's applied changes reach when they reach this one
    // (what the review dialog's "What happens next" names), so the button, that footer and the Publish dialog agree.
    const profiles = profile ? withSession(profile, awaiting) : profilesToPublish(awaiting);
    return {
      kind: "publish",
      profiles,
      label: profiles?.length ? `Publish to iPad (${plural(profiles.length, "profile")})…` : "Publish to iPad…",
      title: profiles?.length ? `Publish to iPad for ${profiles.join(", ")}` : "Publish to iPad — choose the profiles",
    };
  }
  // Never published: everything is still to go, so the profile's first publish is the next step.
  if (org.kind === "neverPublished" && profile)
    return { kind: "publish", profiles: [profile], label: "Publish to iPad (1 profile)…", title: `Publish to iPad for ${profile}` };
  if (org.kind === "count")
    return profile
      ? { kind: "calm", text: "Reps have everything", title: `${profile}'s iPads have everything in the org` }
      : { kind: "calm", text: "Nothing to publish", title: "Nothing applied in this session is waiting for a publish" };
  return { kind: "none" };
}

/** The previewed profile, and the other profiles the session's applied changes reach if they reach it too. */
function withSession(profile: string, awaiting: PendingChange[]): string[] {
  const reached = profilesToPublish(awaiting);
  const includes = reached?.some((p) => p.toLowerCase() === profile.toLowerCase());
  return includes && reached ? [profile, ...reached.filter((p) => p.toLowerCase() !== profile.toLowerCase())] : [profile];
}

/**
 * "· N org-wide" beside a profile-scoped publish: how many profiles the session's applied changes wait on,
 * when that is known and the publish doesn't already cover them (their changes don't reach this profile).
 */
export function orgWideNote(profile: string | null, awaiting: PendingChange[]): string | null {
  if (!profile || awaiting.length === 0) return null;
  const profiles = profilesToPublish(awaiting);
  if (!profiles || profiles.length === 0) return null;
  if (profiles.some((p) => p.toLowerCase() === profile.toLowerCase())) return null;
  return `${plural(profiles.length, "profile")} org-wide`;
}

/** The "On iPads" step's words. */
export function ipadStepLabel(job: PublishStatus | null, error: string | null, publishedAt: string | undefined, ago: (iso: string) => string): {
  tone: "running" | "done" | "failed" | "idle";
  text: string;
} {
  if (job?.state === "running") return { tone: "running", text: `Publishing to ${plural(job.profiles.length, "profile")}…` };
  if (job?.state === "failed") return { tone: "failed", text: "Publish failed" };
  if (!job && error) return { tone: "failed", text: "Couldn't publish" };
  if (job?.state === "done") return { tone: "done", text: `Published to ${plural(job.profiles.length, "profile")}` };
  return { tone: "idle", text: publishedAt ? `Published ${ago(publishedAt)}` : "On iPads" };
}

export interface VisibleInput {
  /** The page always shows the bar (the preview and a feature's setup, where it replaced the Publish button). */
  always: boolean;
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  lastApply: boolean;
  awaiting: number;
  job: boolean;
}

/** Elsewhere the bar shows only when it has something to say. */
export function barVisible(v: VisibleInput): boolean {
  return v.always || v.pending > 0 || v.canUndo || v.canRedo || v.lastApply || v.awaiting > 0 || v.job;
}
