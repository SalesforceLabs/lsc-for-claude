import type { FeatureMap, StudioItem, StudioSurface } from "./types";

/**
 * Studio's "View as" lens — re-reads a feature map from one profile's point of
 * view using each item's `audience`. Purely client-side; nothing is re-queried.
 */
export type Lens = { profile: string } | null;

/**
 * applies — the profile gets it (or it applies to everyone).
 * conditional — assigned to a permission set; depends on the user, not the profile.
 * excluded — assigned elsewhere, so the profile doesn't get it.
 */
export type Fit = "applies" | "conditional" | "excluded";

export interface LensFit {
  fit: Fit;
  reason?: string;
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

export function fitFor(item: StudioItem, lens: Lens): LensFit {
  const audience = item.audience;
  if (!lens || !audience) return { fit: "applies" };
  if (audience.profiles.some((p) => same(p, lens.profile))) return { fit: "applies", reason: `Assigned to ${lens.profile}` };
  if (audience.permissionSets.length > 0) {
    return {
      fit: "conditional",
      reason: `Only for users with ${audience.permissionSets.join(", ")}${
        audience.profiles.length ? ` (or on ${audience.profiles.join(", ")})` : ""
      }`,
    };
  }
  return {
    fit: "excluded",
    reason: audience.profiles.length ? `Assigned to ${audience.profiles.join(", ")}` : "Not assigned to any profile",
  };
}

/** Whether any item on the surface is assigned per profile, so the lens changes what it shows. */
export function isScoped(surface: StudioSurface): boolean {
  return surface.items.some((i) => i.audience);
}

export function fitCounts(surface: StudioSurface, lens: Lens): Record<Fit, number> {
  const counts: Record<Fit, number> = { applies: 0, conditional: 0, excluded: 0 };
  for (const i of surface.items) counts[fitFor(i, lens).fit]++;
  return counts;
}

/** Items the profile gets, then conditional ones, then the rest — original order within each group. */
export function sortByFit(items: StudioItem[], lens: Lens): StudioItem[] {
  if (!lens) return items;
  const rank: Record<Fit, number> = { applies: 0, conditional: 1, excluded: 2 };
  return items
    .map((item, idx) => ({ item, idx, rank: rank[fitFor(item, lens).fit] }))
    .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
    .map((x) => x.item);
}

/** Profile names the map's items are assigned to — so the picker includes profiles with no active users. */
export function audienceProfiles(map: FeatureMap): string[] {
  return map.surfaces.flatMap((s) => s.items.flatMap((i) => i.audience?.profiles ?? []));
}

/** One line for "Ask Claude" prompts. */
export function lensLine(lens: Lens): string {
  return lens
    ? `I'm viewing this as the "${lens.profile}" profile (Studio's lens ignores permission sets and record-level sharing).`
    : "";
}
