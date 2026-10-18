/**
 * True for pending changes that edit DB Schema records. The renderer can't
 * import src/, so this mirrors touchesDbSchema in src/perf/what-if.ts; a unit
 * test compares the two.
 */
export function touchesDbSchema(fix: Record<string, unknown>): boolean {
  if (fix.kind === "setActive") {
    const r = fix.record as { type?: string; category?: string } | undefined;
    return r?.type === "config" && r.category === "DbSchema";
  }
  return ["setConfigField", "setProfileAssignments", "createConfigRecord", "deleteConfigRecord"].includes(String(fix.kind)) && fix.category === "DbSchema";
}
