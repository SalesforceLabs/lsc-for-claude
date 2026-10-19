import type { FixPreview } from "./types";
import type { PendingChange } from "./changes";
import { reachOfChange, type ChangeReach } from "./reach";

export type { ChangeReach };

/**
 * The review dialog's "What happens next": when each kind of user gets the
 * changes being applied — desktop users at once, iPads after a publish, list
 * views and access as reps open or sync.
 */

export function reachFor(change: PendingChange, preview?: FixPreview & { reach?: ChangeReach }): ChangeReach {
  const reach = reachOfChange(change, preview);
  const profiles = reach.profiles ?? change.affects;
  return profiles?.length ? { ...reach, profiles } : reach;
}

export type NextKind = "desktop" | "publish" | "live" | "nextSync";

export interface NextLine {
  kind: NextKind;
  count: number;
  text: string;
}

const n = (count: number, noun = "change") => `${count} ${noun}${count === 1 ? "" : "s"}`;

function listed(names: string[]): string {
  if (names.length === 0) return "their profiles";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more profiles`;
}

/**
 * One line per way the changes travel. `done` words them for after the apply
 * (the banner), so the footer and the banner always say the same thing.
 */
export function whatHappensNext(reaches: ChangeReach[], { done = false }: { done?: boolean } = {}): NextLine[] {
  const desktop = reaches.filter((r) => r.desktop === "now").length;
  const publish = reaches.filter((r) => r.ipad === "publish");
  const live = reaches.filter((r) => r.ipad === "live").length;
  const nextSync = reaches.filter((r) => r.ipad === "nextSync").length;
  const profiles = [...new Map(publish.flatMap((r) => r.profiles ?? []).map((p) => [p.toLowerCase(), p])).values()];
  const out: NextLine[] = [];
  if (desktop)
    out.push({
      kind: "desktop",
      count: desktop,
      text: done ? `Desktop users see ${n(desktop)} now` : `Desktop users see ${n(desktop)} as soon as you apply`,
    });
  if (publish.length)
    out.push({
      kind: "publish",
      count: publish.length,
      text: done
        ? `iPads get ${n(publish.length)} once you publish to ${listed(profiles)}`
        : `iPads get ${n(publish.length)} after you publish to ${listed(profiles)}`,
    });
  if (live)
    out.push({
      kind: "live",
      count: live,
      text: done
        ? `${n(live, "list view change")} ${live === 1 ? "is" : "are"} on iPads now`
        : `${n(live, "list view change")} ${live === 1 ? "updates" : "update"} on iPads right away`,
    });
  if (nextSync)
    out.push({
      kind: "nextSync",
      count: nextSync,
      text: `${n(nextSync)} ${nextSync === 1 ? "reaches" : "reach"} reps on their next sync`,
    });
  return out;
}

/** The server's "publish afterwards" warning: the footer says it, once for every change. */
export const isPublishWarning = (w: string) => /^Publish to iPad afterwards/.test(w);
