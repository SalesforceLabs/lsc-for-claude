import type { ScreenContext } from "../context.js";
import { readKamPlan, readKamSetting, type KamPlan } from "./kam.js";
import { nomenclatureOf, progressMode } from "./logic.js";

export interface KamPlanAnswer {
  plan: KamPlan | null;
  mode: "status" | "percentage";
  nomenclature: ReturnType<typeof nomenclatureOf>;
  notes: string[];
}

/**
 * One plan outside the preview's list (`studio_kam_plan`), read as the connected account. The list holds the 25 most
 * recently changed plans; this reads any other by its Id with the tables the viewer's device syncs (`sync`).
 */
export async function loadKamPlan(
  org: string,
  object: "AccountPlan" | "TerritoryBusinessPlan",
  id: string,
  sync: string[]
): Promise<KamPlanAnswer> {
  const notes: string[] = [];
  const tables = new Set(sync);
  const ctx = {
    org,
    adminOrg: org,
    source: "admin",
    userId: "",
    territories: [],
    format: { timeZone: "UTC", locale: "en-US" },
    scope: (t: string) => (tables.has(t) ? "" : undefined),
    config: async () => ({}),
    note: (m: string) => notes.push(m),
  } as unknown as ScreenContext;
  const [plan, setting] = await Promise.all([readKamPlan(ctx, object, id), readKamSetting(ctx)]);
  return {
    plan: plan ?? null,
    mode: progressMode(setting?.ProgressDisplayMode),
    nomenclature: nomenclatureOf(setting),
    notes,
  };
}
