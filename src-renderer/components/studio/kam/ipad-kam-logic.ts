/**
 * Key Account Management plan pages: what the iPad's accordion draws, as pure rules
 * (lifesciences-ios module/KAM). Studio draws it read-only from `screens.kam`.
 */

import type {
  KamActionPlan,
  KamNomenclature,
  KamObjective,
  KamPlan,
  KamStatusKind,
  KamTask,
  PublishedKam,
} from "../screens/kam/kam-types";

export type BadgeVariant = "base" | "info" | "success";

/** PlanHierarchyStatus.swift PlanStatusBadgeMapper: In Progress is info, Completed success, the rest base. */
export function badgeVariant(kind: KamStatusKind): BadgeVariant {
  return kind === "inProgress" ? "info" : kind === "completed" ? "success" : "base";
}

/** PlanStatusBadgeMapper.iconAssetName: utility:spinner / utility:check / utility:clock. */
export function badgeIcon(kind: KamStatusKind): "spinner" | "check" | "clock" {
  return kind === "inProgress" ? "spinner" : kind === "completed" ? "check" : "clock";
}

export type Completion =
  | { type: "badge"; text: string; variant: BadgeVariant; icon: "spinner" | "check" | "clock" }
  | { type: "progress"; percent: number };

/** PlanHierarchyProgressPresentation.completion: a percentage bar in Percentage mode (Completed reads 100%), else the status badge. */
export function completion(
  kind: KamStatusKind,
  percent: number,
  status: string | null,
  mode: PublishedKam["mode"]
): Completion {
  if (mode === "percentage")
    return { type: "progress", percent: kind === "completed" ? 100 : percent };
  return {
    type: "badge",
    text: status || "Not Started",
    variant: badgeVariant(kind),
    icon: badgeIcon(kind),
  };
}

/** AssessmentTaskAccordionItem.completion: a tactic that isn't Completed offers "Mark as Complete", else the badge. */
export function taskCompletion(
  task: KamTask
): { type: "markComplete"; title: string } | Completion {
  if (task.kind !== "completed") return { type: "markComplete", title: "Mark as Complete" };
  return {
    type: "badge",
    text: task.status || "Not Started",
    variant: badgeVariant("completed"),
    icon: badgeIcon("completed"),
  };
}

/** LSCKAMNomenclatureStrings.countTerm: the configured term for a count chip. */
function countTerm(count: number, singular?: string, plural?: string): string | undefined {
  return count === 1 ? (singular ?? plural) : (plural ?? singular);
}

/** LSCKAMNomenclatureStrings.actionPlanCount: "1 Action Plan" / "3 Action Plans", or "3 {term}" when the org names them. */
export function actionPlanCount(count: number, n: KamNomenclature): string {
  const term = countTerm(count, n.actionPlan, n.actionPlanPlural);
  if (!term) return count === 1 ? "1 Action Plan" : `${count} Action Plans`;
  return `${count} ${term}`;
}

/** LSCKAMNomenclatureStrings.tacticCount: "1 tactic" / "3 tactics". */
export function tacticCount(count: number, n: KamNomenclature): string {
  const term = countTerm(count, n.tactic, n.tacticPlural);
  if (!term) return count === 1 ? "1 tactic" : `${count} tactics`;
  return `${count} ${term}`;
}

/** LSCKAMNomenclatureStrings.objectivesTitle. */
export function objectivesTitle(n: KamNomenclature): string {
  return n.objectivePlural ?? "Objectives";
}

export interface Chip {
  label?: string;
  value: string;
  emphasis?: boolean;
}

/** ObjectiveAccordionItem.metadataItems: action-plan count, Product (first + "+N more"), Owner, Assigned to. */
export function objectiveChips(o: KamObjective, n: KamNomenclature): Chip[] {
  const chips: Chip[] = [{ value: actionPlanCount(o.actionPlans.length, n) }];
  if (o.products.length)
    chips.push({
      label: "Product:",
      value:
        o.products.length > 1 ? `${o.products[0]} +${o.products.length - 1} more` : o.products[0],
      emphasis: true,
    });
  if (o.owner) chips.push({ label: "Owner:", value: o.owner, emphasis: true });
  if (o.assignedTo) chips.push({ label: "Assigned to:", value: o.assignedTo, emphasis: true });
  return chips;
}

/** ActionPlanAccordionItem.metadataItems: tactic count, Owner, Assigned to (the tactics' distinct assignees, comma separated). */
export function actionPlanChips(a: KamActionPlan, n: KamNomenclature): Chip[] {
  const chips: Chip[] = [{ value: tacticCount(a.tasks.length, n) }];
  if (a.owner) chips.push({ label: "Owner:", value: a.owner, emphasis: true });
  const assignees = [...new Set(a.tasks.map((t) => t.assignedTo).filter((v): v is string => !!v))];
  if (assignees.length)
    chips.push({ label: "Assigned to:", value: assignees.join(", "), emphasis: true });
  return chips;
}

/** The short date a Due Date column shows, in the viewer's locale; "—" when none (AssessmentTaskAccordionItem.columns). */
export function dueLabel(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    timeZone: "UTC",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  });
}

export type KamPart = "objectives" | "stakeholders" | "participants" | "actionPlans";

/**
 * Which KAM component a flexipage component is (KAMModule.getComponent): `kamObjectivesList` is the accordion; the older
 * `AccountPlanRelatedTodoList` / `TerritoryBusinessPlanRelatedObjectivesList` are the legacy list; a related list container named
 * AccountPlanStakeholders / AccountPlanParticipants on a plan opens its own tab; the action-plan list card lists a record's Action Plans.
 */
export function kamPart(
  name: string,
  relatedListApiName: string | undefined
): { part: KamPart; legacy: boolean } | null {
  const bare = name.replace(/^.*:/, "");
  if (bare === "kamObjectivesList") return { part: "objectives", legacy: false };
  if (/AccountPlanRelatedTodoList$|TerritoryBusinessPlanRelatedObjectivesList$/.test(bare))
    return { part: "objectives", legacy: true };
  if (name === "runtime_industries_actionplan:listCard")
    return { part: "actionPlans", legacy: false };
  if (bare === "relatedListSingleContainer" && relatedListApiName) {
    const api = relatedListApiName.replace(/^.*__/, "");
    if (api.startsWith("AccountPlanStakeholders")) return { part: "stakeholders", legacy: false };
    if (api.startsWith("AccountPlanParticipants")) return { part: "participants", legacy: false };
  }
  return null;
}

/** The plan whose page this is, or the objective's own Action Plans on an objective page. */
export function planFor(kam: PublishedKam | undefined, recordId: string): KamPlan | undefined {
  return kam?.plans[recordId];
}

export function objectiveFor(
  kam: PublishedKam | undefined,
  recordId: string
): KamObjective | undefined {
  for (const plan of Object.values(kam?.plans ?? {})) {
    const hit = plan.objectives.find((o) => o.id === recordId);
    if (hit) return hit;
  }
  return undefined;
}

/** StakeholdersTabViewModel: a stakeholder without an account reads "Non-Profiled". */
export function stakeholderColumns(s: {
  role: string | null;
  influence: string | null;
  strength: string | null;
  comment?: string | null;
}): { label: string; value: string }[] {
  const cols = [
    { label: "Role", value: s.role || "—" },
    { label: "Influence Level", value: s.influence || "—" },
    { label: "Strength", value: s.strength || "—" },
  ];
  if (s.comment) cols.push({ label: "Comment", value: s.comment });
  return cols;
}

/** LSCKAMNomenclatureStrings.addObjectiveToGetStarted (the container's empty state). */
export function emptyObjectives(n: KamNomenclature): string {
  return n.objective
    ? `Add a new ${n.objective} to get started`
    : "Add an objective to get started";
}

/* ---- Plan page controls (lifesciences-ios module/KAM) ---- */

/** Text without case and accents, so "Cardio" finds "cárdio" (the SQL search is case-insensitive). */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * PlanHierarchyCascadeObjectiveDataSourceBase.searchPredicate(levels: widenedLevels(...)): an objective stays when its own name
 * or the name of an Action Plan or tactic under it contains the search text.
 */
export function objectiveMatchesSearch(o: KamObjective, term: string): boolean {
  const t = fold(term.trim());
  if (!t) return true;
  const has = (v: string | null | undefined) => !!v && fold(v).includes(t);
  return (
    has(o.title) ||
    o.actionPlans.some((a) => has(a.title) || a.tasks.some((k) => has(k.name)))
  );
}

export interface ObjectiveFilter {
  search: string;
  /** Status buckets picked in the status selector; empty = All. */
  statuses: KamStatusKind[];
  /** Product names picked in the Filter sheet; empty = no product filter. */
  products: string[];
}

export const NO_FILTER: ObjectiveFilter = { search: "", statuses: [], products: [] };

/** ObjectiveViewModel: search, status and product narrow the objectives together. */
export function filterObjectives(objectives: KamObjective[], f: ObjectiveFilter): KamObjective[] {
  return objectives.filter(
    (o) =>
      objectiveMatchesSearch(o, f.search) &&
      (!f.statuses.length || f.statuses.includes(o.kind)) &&
      (!f.products.length || o.products.some((p) => f.products.includes(p)))
  );
}

export interface StatusOption {
  id: "all" | KamStatusKind;
  label: string;
  count: number;
}

/** ObjectiveViewModel.availableStatusOptions: "All" plus In Progress, Completed, Not Started, counted over the objectives matching the search and product filter. */
export function statusOptions(objectives: KamObjective[], f: ObjectiveFilter): StatusOption[] {
  const base = filterObjectives(objectives, { ...f, statuses: [] });
  const n = (k: KamStatusKind) => base.filter((o) => o.kind === k).length;
  return [
    { id: "all", label: "All", count: base.length },
    { id: "inProgress", label: "In Progress", count: n("inProgress") },
    { id: "completed", label: "Completed", count: n("completed") },
    { id: "notStarted", label: "Not Started", count: n("notStarted") },
  ];
}

/** ObjectiveViewModel.selectedStatusButtonTitle: "Status All" / "Status Completed". */
export function statusButtonTitle(statuses: KamStatusKind[]): string {
  if (statuses.length !== 1) return "Status All";
  const label = { completed: "Completed", inProgress: "In Progress", notStarted: "Not Started", other: "Other" }[
    statuses[0]
  ];
  return `Status ${label}`;
}

/** The Filter sheet's product choices: every product on the plan's objectives, by name, with how many objectives carry it. */
export function productOptions(objectives: KamObjective[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const o of objectives) for (const p of o.products) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export type KebabKind = "add" | "edit" | "markIncomplete" | "delete" | "assignSprint";
export interface KebabItem {
  kind: KebabKind;
  title: string;
  destructive?: boolean;
  /** The object a create or edit form is drawn for. */
  object?: string;
}

/**
 * PlanHierarchyActionsProvider.definitions, in menu order (Add New, Assign or Unassign Sprint, Edit, Mark as Incomplete, Delete),
 * with the handlers each row type passes: an Objective has Add (an Action Plan), Edit, Delete (SFObjectiveView `objectiveKebabHandlers`);
 * an Action Plan has Add (a tactic), Sprint (Account Plans only), Edit, Delete; a tactic has Edit, Mark as Incomplete (only once
 * Completed, ActionPlanCardBuilder.hiddenAssessmentTaskKebabActionTypes) and Delete.
 */
export function kebabItems(
  level: "objective" | "actionPlan" | "tactic",
  kind: KamStatusKind,
  planObject: KamPlan["object"],
  n: KamNomenclature
): KebabItem[] {
  const term = {
    objective: n.objective ?? "Objective",
    actionPlan: n.actionPlan ?? "Action Plan",
    tactic: n.tactic ?? "Tactic",
  };
  const object = { objective: "AccountPlanObjective", actionPlan: "ActionPlan", tactic: "AssessmentTask" }[level];
  const out: KebabItem[] = [];
  if (level === "objective")
    out.push({ kind: "add", title: `Add New ${term.actionPlan}`, object: "ActionPlan" });
  if (level === "actionPlan") {
    out.push({ kind: "add", title: `Add New ${term.tactic}`, object: "AssessmentTask" });
    if (planObject === "AccountPlan")
      out.push({ kind: "assignSprint", title: "Assign or Unassign Sprint" });
  }
  out.push({ kind: "edit", title: `Edit ${term[level]}`, object });
  if (level === "tactic" && kind === "completed")
    out.push({ kind: "markIncomplete", title: "Mark as Incomplete" });
  out.push({ kind: "delete", title: `Delete ${term[level]}`, destructive: true });
  return out;
}

export interface AddItem {
  id: "new" | "importTerritory";
  title: string;
}

/**
 * ObjectiveAccordionHeaderView.addControl: "Add New Objective" alone is a plain button; with import sources it is an "Add" menu of that
 * plus "Import from Territory Business Plan" (ObjectiveViewModel.importSources: Account Plans only, and only when the user can create objectives).
 */
export function addItems(planObject: KamPlan["object"], canImport: boolean, n: KamNomenclature): AddItem[] {
  const items: AddItem[] = [{ id: "new", title: `Add New ${n.objective ?? "Objective"}` }];
  if (planObject === "AccountPlan" && canImport)
    items.push({ id: "importTerritory", title: "Import from Territory Business Plan" });
  return items;
}

/** Territory Business Plans the Import sheet can pick from ("Select Territory Plan"), with their objectives. */
export function importSourcePlans(kam: PublishedKam): { id: string; plan: KamPlan }[] {
  return Object.entries(kam.plans)
    .filter(([, p]) => p.object === "TerritoryBusinessPlan")
    .map(([id, plan]) => ({ id, plan }));
}

/** Account Plans other than this one that have stakeholders (the "Import from Account Plans" sheet). */
export function importStakeholderPlans(kam: PublishedKam, planId: string): { id: string; stakeholders: NonNullable<KamPlan["stakeholders"]> }[] {
  return Object.entries(kam.plans)
    .filter(([id, p]) => id !== planId && p.object === "AccountPlan" && !!p.stakeholders?.length)
    .map(([id, p]) => ({ id, stakeholders: p.stakeholders ?? [] }));
}

/** StakeholdersTabViewModel search (StakeholderWhereAndSortClauseBuilder.addFilterSearchText): the name or any shown column contains the text. */
export function stakeholderMatches(
  s: { title: string; role: string | null; influence: string | null; strength: string | null; comment?: string | null },
  term: string
): boolean {
  const t = fold(term.trim());
  if (!t) return true;
  return [s.title, s.role, s.influence, s.strength, s.comment].some((v) => !!v && fold(v).includes(t));
}

/** Mark: a plan the list lacks is read on demand; the object kind comes from the record's own type. */
export function planObjectOf(objectApi: string | undefined): KamPlan["object"] | null {
  return objectApi === "AccountPlan" || objectApi === "TerritoryBusinessPlan" ? objectApi : null;
}
