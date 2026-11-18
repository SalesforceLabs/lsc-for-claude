/**
 * Key Account Management plan hierarchy (lifesciences-ios module/KAM): the pure rules the collector applies.
 * Account Plan -> Objective -> Action Plan -> Tactic (AssessmentTask); a Territory Business Plan reaches
 * its Action Plans through Goal Assignments.
 */

export type StatusKind = "completed" | "inProgress" | "notStarted" | "other";

/** PlanHierarchyStatus.swift PlanStatusKind.init(rawStatus:): spaces dropped, case ignored. */
export function statusKind(raw: string | null | undefined): StatusKind {
  const v = (raw ?? "").replace(/ /g, "").toLowerCase();
  if (v === "completed") return "completed";
  if (v === "inprogress") return "inProgress";
  if (v === "notstarted") return "notStarted";
  return "other";
}

export type ProgressDisplayMode = "status" | "percentage";

/** LSCDBKAMConfigurations.swift KAMProgressDisplayMode: "Percentage" or (anything else, or unset) Status. */
export function progressMode(raw: unknown): ProgressDisplayMode {
  return typeof raw === "string" && raw === "Percentage" ? "percentage" : "status";
}

export interface KamNomenclature {
  objective?: string;
  objectivePlural?: string;
  actionPlan?: string;
  actionPlanPlural?: string;
  tactic?: string;
  tacticPlural?: string;
}

const NOMENCLATURE_KEYS: [keyof KamNomenclature, string][] = [
  ["objective", "NomenclatureObjective"],
  ["objectivePlural", "NomenclatureObjectivePlural"],
  ["actionPlan", "NomenclatureActionPlan"],
  ["actionPlanPlural", "NomenclatureActionPlanPlural"],
  ["tactic", "NomenclatureTactic"],
  ["tacticPlural", "NomenclatureTacticPlural"],
];

/** LSCDBKAMConfigurations.nomenclature: a term counts only when it isn't blank after trimming. */
export function nomenclatureOf(setting: Record<string, unknown> | undefined): KamNomenclature {
  const out: KamNomenclature = {};
  for (const [key, field] of NOMENCLATURE_KEYS) {
    const v = setting?.[field];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/** A due date as the device shows its short date: kept as the ISO day so the preview formats it for the viewer's locale. */
export function dueDay(raw: unknown): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** Per-parent lists keep the device's order: Action Plans newest change first (PlanHierarchyCascadeActionPlanItems), Objectives too (AccountPlanObjectiveDataSource orderBy). */
export function newestFirst<T extends { modified: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
}
