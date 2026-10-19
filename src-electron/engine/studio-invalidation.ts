/**
 * What a write makes stale in Studio's persistent cache. Pure (no database), so it can be tested.
 *
 * An applied change can alter any feature's map, readiness and the Setup Overview, and the details of
 * any item, so those always go. What it usually does NOT touch is kept, because it is the slowest data
 * Studio loads: the published iPad (read from the profile's last downloaded metadata cache, which only a
 * publish changes), the profile list and the permission options.
 */

const MAPS = ["studio_feature_map", "studio_item_detail", "studio_readiness", "studio_setup_overview", "studio_unpublished", "studio_custom_scripts"];
/** Sync volume depends on DB Schema, who has which access and territories — not on layouts or script code. */
const SYNC = ["studio_sync_user", "studio_sync_overview"];
const PUBLISHED = "studio_ipad_published";

interface FixLike {
  kind?: unknown;
  doc?: { type?: unknown } | null;
}

/** Kinds that only edit metadata documents and scripts; they can't change what a rep syncs. */
const NO_SYNC_EFFECT = new Set([
  "editMetadata",
  "setCustomScriptCode",
  "setLayoutRelatedList",
  "copyForProfile",
  "createCustomScript",
  "saveCustomScript",
  "deleteCustomScript",
  "assignCustomScript",
]);

/** Whether the published iPad preview reads something this fix changes (list views are read live from the org). */
export function fixAffectsPublished(fix: unknown): boolean {
  const f = (fix ?? {}) as FixLike;
  if (f.kind === "editMetadata") return f.doc?.type === "ListView";
  // A copy re-points the profile's layout / page assignment, which the preview resolves from its own cache but
  // the copy itself is read live.
  return f.kind === "copyForProfile";
}

/** Cached tools to drop after `fix` was applied (or may have been). */
export function toolsInvalidatedByApply(fix: unknown): string[] {
  const f = (fix ?? {}) as FixLike;
  const tools = [...MAPS];
  if (typeof f.kind !== "string" || !NO_SYNC_EFFECT.has(f.kind)) tools.push(...SYNC);
  if (fixAffectsPublished(fix)) tools.push(PUBLISHED);
  return tools;
}

/** Cached tools to drop once a publish finishes: the metadata cache surfaces and what is read from the cache. */
export const INVALIDATED_BY_PUBLISH = [
  "studio_unpublished",
  "studio_feature_map",
  "studio_readiness",
  "studio_setup_overview",
  "studio_ipad_published",
  "studio_sync_user",
];

/** Cached tools to drop when the user refreshes a feature map: the org changed under it. */
export const INVALIDATED_BY_MAP_REFRESH = ["studio_unpublished", "studio_item_detail", "studio_list_profiles", "studio_access_options", "studio_ipad_published"];

/**
 * A counter per org that moves on every invalidation. A load that began before a write must not store
 * its (pre-write) answer in the cache, nor share another caller's pre-write load.
 */
const generations = new Map<string, number>();
export const generationOf = (org: string): number => generations.get(org) ?? 0;
export function bumpGeneration(org: string): number {
  const next = generationOf(org) + 1;
  generations.set(org, next);
  return next;
}

/** Cached tools to drop after an LSC app deploy: the new bundle shows up in maps, the component catalog and the unpublished list. */
export const INVALIDATED_BY_APP_DEPLOY = [...MAPS, "studio_component_catalog", "studio_app_list"];
