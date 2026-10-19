import { MOBILE_CATEGORIES, type PendingChange } from "./changes";
import type { UnpublishedItem } from "./org-ahead";

/**
 * Where a change shows up once it is applied: on the desktop (Salesforce in a browser) and on reps' iPads.
 * Structural copy of `ChangeReach` in src/studio/types.ts, which the server sets on previews and unpublished
 * items; until it does, `reachOfChange` classifies by the kind of change.
 *
 * - `publish`: in the profile's metadata cache, so iPads get it after Publish to iPad.
 * - `live`: the iPad reads it from the org (list views, server-side rules), so it is there at once.
 * - `nextSync`: data the iPad downloads (assignments, custom script code), so reps get it on their next sync.
 * - `none`: nothing a rep would see on the iPad changes.
 */
export interface ChangeReach {
  desktop: "now" | "none";
  ipad: "publish" | "live" | "nextSync" | "none";
  /** Profiles whose iPads change; undefined = every profile, or not known. */
  profiles?: string[];
}

const reach = (desktop: ChangeReach["desktop"], ipad: ChangeReach["ipad"], profiles?: string[]): ChangeReach =>
  profiles ? { desktop, ipad, profiles } : { desktop, ipad };

/** Where a queued or applied change lands. The server's answer (`preview.reach`) wins when there is one. */
export function reachOfChange(c: PendingChange, preview?: { reach?: ChangeReach } | null): ChangeReach {
  if (preview?.reach) return preview.reach;
  const fix = c.fix;
  switch (fix.kind) {
    case "editMetadata":
      // The iPad lists views from the org when a rep opens them; everything else is read from the cache.
      return fix.doc.type === "ListView" ? reach("now", "live") : reach("now", "publish", c.affects);
    case "copyForProfile":
    case "setLayoutRelatedList":
      return reach("now", "publish", c.affects);
    case "setConfigField":
    case "setProfileAssignments":
    case "createConfigRecord":
    case "deleteConfigRecord":
      // Mobile Admin Console records only reach reps through the cache; the rest run in the org for everyone.
      return MOBILE_CATEGORIES.has(fix.category) ? reach("none", "publish", c.affects) : reach("now", "live");
    case "setActive":
      if (fix.record.type === "config" && MOBILE_CATEGORIES.has(fix.record.category)) return reach("none", "publish", c.affects);
      return reach("now", "live");
    case "setCustomScriptCode":
    case "assignPsl":
    case "removePsl":
    case "assignAccess":
    case "removeAccess":
      return reach("now", "nextSync");
  }
}

/** The tray row's "where it lands" words: "Desktop now · iPad after publish". */
export function reachLabel(r: ChangeReach): string {
  const desktop = r.desktop === "now";
  switch (r.ipad) {
    case "publish":
      return desktop ? "Desktop now · iPad after publish" : "iPad after publish";
    case "live":
      return desktop ? "Desktop now · iPad now" : "iPad now";
    case "nextSync":
      return desktop ? "Desktop now · iPad next sync" : "Next sync";
    case "none":
      return desktop ? "Desktop only" : "Nothing reps see";
  }
}

/** Whether an item in the org still has to be published before reps get it (server `reach`, else not `live`). */
export function awaitsPublish(item: UnpublishedItem & { reach?: ChangeReach }): boolean {
  return item.reach ? item.reach.ipad === "publish" : !item.live;
}

/**
 * Profiles to publish for a set of applied changes that wait for a publish: their `affects`, or null when
 * one of them reaches every profile (or nobody knows which).
 */
export function profilesToPublish(changes: PendingChange[]): string[] | null {
  const names = new Map<string, string>();
  for (const c of changes) {
    const r = reachOfChange(c);
    if (r.ipad !== "publish") continue;
    const list = r.profiles ?? c.affects;
    if (!list) return null;
    for (const n of list) names.set(n.toLowerCase(), n);
  }
  return [...names.values()];
}

/**
 * What still waits for a publish once `published` profiles were published: a change is done when every
 * profile it reaches was in the publish; one that reaches everyone (or unknown) is taken as done by any publish.
 */
export function stillAwaiting(awaiting: PendingChange[], published: string[]): PendingChange[] {
  const done = new Set(published.map((p) => p.toLowerCase()));
  return awaiting.filter((c) => {
    const list = reachOfChange(c).profiles ?? c.affects;
    return !!list && list.some((p) => !done.has(p.toLowerCase()));
  });
}
