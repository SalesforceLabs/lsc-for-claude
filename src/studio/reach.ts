/**
 * Where a Studio change lives once applied: desktop/web at once or never, and on iPads after
 * Publish to iPad, live (read from the org when opened), on the rep's next sync, or never.
 * One table for every StudioFix kind, so the review dialog, the tray and the publish warning agree.
 */

import { PUBLISH_WARNING } from "./change-helpers.js";
import type { ChangeReach, FixPreview, StudioFix } from "./types.js";
import { MOBILE_CATEGORIES } from "./unpublished-logic.js";

/** Admin Console categories read into a profile's metadata cache — the same list "changes not on iPads yet" counts. */
const CACHED_CATEGORIES = new Set(MOBILE_CATEGORIES);

const uniq = (names: string[]) => {
  const seen = new Map<string, string>();
  for (const n of names.map((x) => x.trim()).filter(Boolean)) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen.values()];
};

const splitNames = (v: string | number | null) => (typeof v === "string" ? v.split(/[,;]/) : []);

/** An Admin Console record: mobile categories reach the iPad only through a publish and aren't shown on desktop. */
function configReach(category: string, profiles?: string[]): ChangeReach {
  if (!CACHED_CATEGORIES.has(category)) return { desktop: "now", ipad: "none" };
  const named = profiles ? uniq(profiles) : [];
  return { desktop: "none", ipad: "publish", ...(named.length ? { profiles: named } : {}) };
}

/**
 * The reach of a change. `profiles` is what the preview found out about who it reaches (a page's
 * or app's profiles); the fix's own profile lists are used when it carries them.
 */
export function reachOfFix(fix: StudioFix, profiles?: string[]): ChangeReach {
  const withProfiles = (r: ChangeReach, names = profiles): ChangeReach => {
    const named = names ? uniq(names) : [];
    return named.length && r.ipad !== "none" ? { ...r, profiles: named } : r;
  };
  switch (fix.kind) {
    case "assignPsl":
    case "removePsl":
    case "assignAccess":
    case "removeAccess":
      // Access is data: the rep's next sync picks it up, no publish needed.
      return { desktop: "now", ipad: "nextSync" };
    case "setConfigField":
      // An action's Profiles field: everyone listed before or after is reached.
      return configReach(fix.category, fix.field === "Profiles" ? [...splitNames(fix.from), ...splitNames(fix.to)] : profiles);
    case "setProfileAssignments":
      return configReach(fix.category, [...fix.from, ...fix.to]);
    case "createConfigRecord":
      return configReach(fix.category, fix.profiles);
    case "deleteConfigRecord":
      return configReach(fix.category, profiles);
    case "setActive":
      if (fix.record.type === "config") return configReach(fix.record.category, profiles);
      // Trigger handlers and validation rules run on the server, when a rep's offline edits sync.
      return { desktop: "now", ipad: "nextSync" };
    case "setCustomScriptCode":
      // The iPad reads CodeText from its metadata cache.
      return withProfiles({ desktop: "now", ipad: "publish" });
    case "setLayoutRelatedList":
      return withProfiles({ desktop: "now", ipad: "publish" });
    case "editMetadata":
      // The iPad lists an object's views from the org when a rep opens them.
      if (fix.doc.type === "ListView") return { desktop: "now", ipad: "live" };
      return withProfiles({ desktop: "now", ipad: "publish" });
    case "copyForProfile":
      return withProfiles({ desktop: "now", ipad: "publish" }, [fix.profile]);
  }
}

/** Sets the preview's reach (keeping one a preview worked out itself) and drops the publish warning where no publish is needed. */
export function withReach(preview: FixPreview, fix: StudioFix): FixPreview {
  const reach = preview.reach ?? reachOfFix(fix);
  const warnings = reach.ipad === "publish" ? preview.warnings : preview.warnings.filter((w) => w !== PUBLISH_WARNING);
  return { ...preview, warnings, reach };
}
