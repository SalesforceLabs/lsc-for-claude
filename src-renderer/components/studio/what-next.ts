import type { FixPreview, StudioFix } from "./types";
import { isMobileChange, type PendingChange } from "./changes";

/**
 * The review dialog's "What happens next": when each kind of user gets the
 * changes being applied — desktop users at once, iPads after a publish, list
 * views and access as reps open or sync.
 */

/** Who gets a change and when (the server's `FixPreview.reach`; worked out here when a preview has none). */
export interface ChangeReach {
  desktop: "now" | "none";
  ipad: "publish" | "live" | "nextSync" | "none";
  profiles?: string[];
}

/** Kept until every server preview carries `reach`; matches what the server says for each kind. */
function fallbackReach(fix: StudioFix): ChangeReach {
  switch (fix.kind) {
    case "editMetadata":
      return fix.doc.type === "ListView" ? { desktop: "now", ipad: "live" } : { desktop: "now", ipad: "publish" };
    case "copyForProfile":
    case "setLayoutRelatedList":
      return { desktop: "now", ipad: "publish" };
    case "assignPsl":
    case "removePsl":
    case "assignAccess":
    case "removeAccess":
    case "setCustomScriptCode":
      return { desktop: "now", ipad: "nextSync" };
    default:
      // Admin Console's mobile categories only reach the iPad, through its metadata cache.
      return isMobileChange(fix) ? { desktop: "none", ipad: "publish" } : { desktop: "now", ipad: "none" };
  }
}

export function reachFor(change: PendingChange, preview?: FixPreview & { reach?: ChangeReach }): ChangeReach {
  const reach = preview?.reach ?? fallbackReach(change.fix);
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
