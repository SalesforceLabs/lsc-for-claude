import type { ChecklistStep, FeatureMap, StudioFinding, StudioItem, StudioSurface } from "./types";
import { allFindings, worstSeverity } from "./findings";
import { fitFor, type Lens } from "./lens";
import { effectiveProfiles, itemAffects, profileChange, type PendingChange } from "./changes";

/**
 * The profile check — each step answers "does this profile get it?" for one
 * surface. Purely client-side, like the lens it's built on.
 *
 * ok — the profile gets some of it. missing — it gets none. attention — it gets
 * some, with an error or warning. everyone — the surface isn't assigned per
 * profile. error — the surface couldn't be loaded.
 */
export type CheckStatus = "ok" | "missing" | "attention" | "everyone" | "error";

export interface ChecklistRow {
  step: ChecklistStep;
  surface: StudioSurface;
  status: CheckStatus;
  detail: string;
  /** Whether the step differs per profile — a check the profile can pass or fail. Unloadable steps count too. */
  scoped: boolean;
  /** The worst finding the profile sees on the surface. */
  finding?: StudioFinding;
}

const live = (i: StudioItem) => i.active !== false;
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The map's steps, or every surface in lane order when the feature doesn't define any. */
export function checklistSteps(map: FeatureMap): ChecklistStep[] {
  if (map.checklist) return map.checklist.filter((step) => map.surfaces.some((s) => s.id === step.surface));
  const lane = new Map(map.lanes.map((l, i) => [l.id, i]));
  return [...map.surfaces]
    .sort((a, b) => (lane.get(a.lane) ?? 0) - (lane.get(b.lane) ?? 0))
    .map((s) => ({ surface: s.id, label: s.title }));
}

/** What the profile gets: a couple of names, or "n of total". The profile's own name says nothing here. */
function describe(got: StudioItem[], total: number, lens: NonNullable<Lens>): string {
  const labels = [...new Set(got.map((i) => i.label).filter((l) => !same(l, lens.profile)))];
  if (labels.length === 0 && got.length === 1) return got[0].sublabel ?? "Assigned";
  if (got.length <= 2 && labels.length > 0) return labels.join(", ");
  return `${got.length} of ${total}`;
}

export function checklistRow(step: ChecklistStep, surface: StudioSurface, lens: NonNullable<Lens>): ChecklistRow {
  if (surface.error) return { step, surface, status: "error", detail: "Couldn't load", scoped: true };
  const findings = allFindings(surface, lens);
  const worst = worstSeverity(findings);
  const finding = worst ? findings.find((f) => f.severity === worst) : undefined;
  const serious = worst === "error" || worst === "warning";
  const items = surface.items.filter(live);

  // Only active records can be given to a profile; inactive ones (e.g. disabled DB Schema) aren't something to pass or fail.
  if (!items.some((i) => i.audience)) {
    const inactive = surface.items.length - items.length;
    return {
      step,
      surface,
      status: serious ? "attention" : "everyone",
      detail: items.length ? plural(items.length, "record") : inactive ? `${inactive} inactive` : "None configured",
      scoped: false,
      finding,
    };
  }

  const got = items.filter((i) => fitFor(i, lens).fit === "applies");
  const conditional = items.filter((i) => fitFor(i, lens).fit === "conditional").length;
  const via = conditional ? ` · ${conditional} more through permission sets` : "";
  if (got.length === 0 && conditional === 0) {
    const missing = step.missing ?? "None of the {total} apply to this profile";
    return { step, surface, status: "missing", detail: missing.replace("{total}", String(surface.items.length)), scoped: true, finding };
  }
  const detail = got.length ? describe(got, surface.items.length, lens) + via : via.slice(3);
  return { step, surface, status: serious ? "attention" : "ok", detail, scoped: true, finding };
}

export function checklist(map: FeatureMap, lens: NonNullable<Lens>): ChecklistRow[] {
  return checklistSteps(map).map((step) => checklistRow(step, map.surfaces.find((s) => s.id === step.surface)!, lens));
}

// --- Copying another profile's assignments ------------------------------------

/** Active, re-targetable items the profile doesn't get yet. */
function copyable(surface: StudioSurface, lens: NonNullable<Lens>): StudioItem[] {
  return surface.items.filter((i) => live(i) && i.edit?.profiles && i.audience && fitFor(i, lens).fit !== "applies");
}

/** Profiles whose assignments the profile could copy, most to copy first. */
export function copySources(surfaces: StudioSurface[], lens: NonNullable<Lens>): { profile: string; count: number }[] {
  const counts = new Map<string, { profile: string; count: number }>();
  for (const item of surfaces.flatMap((s) => copyable(s, lens))) {
    for (const p of item.audience!.profiles) {
      if (same(p, lens.profile)) continue;
      const entry = counts.get(p.toLowerCase()) ?? { profile: p, count: 0 };
      entry.count++;
      counts.set(p.toLowerCase(), entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.profile.localeCompare(b.profile));
}

/**
 * Changes giving the profile every item `from` has on these surfaces. `matched`
 * counts them all; items already given in the tray are left out of `changes`.
 */
export function copyChanges(
  surfaces: StudioSurface[],
  lens: NonNullable<Lens>,
  from: string,
  pending: PendingChange[]
): { matched: number; changes: PendingChange[] } {
  const items = surfaces.flatMap((s) => copyable(s, lens)).filter((i) => i.audience!.profiles.some((p) => same(p, from)));
  const changes: PendingChange[] = [];
  for (const item of items) {
    const current = effectiveProfiles(item.edit!, pending);
    if (current.some((p) => same(p, lens.profile))) continue;
    const fix = profileChange(item.edit!, [...current, lens.profile]);
    if (fix) changes.push({ fix: { ...fix, label: `Show ${item.label} to ${lens.profile}` }, affects: itemAffects(item, [lens.profile]) });
  }
  return { matched: items.length, changes };
}
