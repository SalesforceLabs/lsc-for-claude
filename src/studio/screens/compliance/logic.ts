/**
 * Account Compliance rules, ported from lifesciences-ios (OCE/Classes/EPPV, AccountComplianceDataMapper and
 * AccountComplianceCycleSortService). Pure: dates are `YYYY-MM-DD` strings and "today" is passed in.
 */

export type PlanState =
  | "notStarted"
  | "inProgress"
  | "completed"
  | "stopped"
  | "restarted"
  | "other";
export type CycleStatus =
  | "notStarted"
  | "upcoming"
  | "dueSoon"
  | "overDue"
  | "complete"
  | "skipped";
export type CycleAction =
  | "none"
  | "viewOnWeb"
  | "createVisit"
  | "viewVisit"
  | "addSkipReason"
  | "viewSkipReason";

export interface RawCycle {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  status: string | null;
  delayReason: string | null;
  completionTaskId: string | null;
}

export interface CycleView {
  /** Position in the table: the index, or index + 1 once a pre-delivery cycle is Cycle 0. */
  number: number;
  name: string;
  start: string | null;
  end: string | null;
  status: CycleStatus;
  action: CycleAction;
  /** A secondary action on an overdue cycle (AccountComplianceDataMapper.cycleActionsForDetail). */
  secondaryAction?: CycleAction;
  visitId?: string;
}

const DEFAULT_STATES: Record<Exclude<PlanState, "other">, string> = {
  notStarted: "Not Started",
  inProgress: "In Progress",
  completed: "Completed",
  stopped: "Stopped",
  restarted: "Restarted",
};

/** ActionPlanStateMapper: case-insensitive match on trimmed values, the org's custom setting overriding the defaults. */
export function mapPlanState(
  raw: string | null | undefined,
  overrides: Partial<Record<keyof typeof DEFAULT_STATES, string>> = {}
): PlanState {
  const v = (raw ?? "").trim().toLowerCase();
  for (const key of Object.keys(DEFAULT_STATES) as (keyof typeof DEFAULT_STATES)[]) {
    const want = (overrides[key]?.trim() || DEFAULT_STATES[key]).toLowerCase();
    if (v === want) return key;
  }
  return "other";
}

/** AccountComplianceDataMapper.determineStatusLabel. */
export function stateLabel(state: PlanState): string {
  switch (state) {
    case "notStarted":
      return "Account Compliance Not Started";
    case "inProgress":
    case "restarted":
      return "Account Compliance in Progress";
    case "completed":
      return "Account Compliance Completed";
    case "stopped":
      return "Account Compliance Stopped";
    default:
      return "Account Compliance";
  }
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

/** AccountComplianceDataMapper.resolveCycleStatus / computeDateBasedStatus. */
export function cycleStatus(
  c: Pick<RawCycle, "start" | "end" | "status">,
  today: string
): CycleStatus {
  const raw = (c.status ?? "").trim().toLowerCase();
  if (raw === "completed") return "complete";
  if (raw === "skipped") return "skipped";
  if (!c.end) return "upcoming";
  if (c.end < today) return "overDue";
  const days = dayDiff(c.end, today);
  if (days <= 3) return "dueSoon";
  if (days <= 7) return "upcoming";
  if (c.start && c.start > today) return "notStarted";
  return "upcoming";
}

/** findCurrentCycle: the cycle containing today, else the first future one, else the last. */
export function currentCycleIndex(
  cycles: { start: string | null; end: string | null }[],
  today: string
): number {
  if (!cycles.length) return -1;
  const within = cycles.findIndex((c) => c.start && c.end && c.start <= today && today <= c.end);
  if (within >= 0) return within;
  const future = cycles.findIndex((c) => c.start && c.start > today);
  return future >= 0 ? future : cycles.length - 1;
}

/** AccountComplianceDataMapper.cycleAction. `visitId` undefined means no visit is known. */
export function cycleAction(
  status: CycleStatus,
  visitId: string | undefined,
  delayReason: string | null
): CycleAction {
  switch (status) {
    case "notStarted":
      return "none";
    case "upcoming":
    case "dueSoon":
    case "overDue":
      return visitId ? "viewVisit" : "createVisit";
    case "complete":
      return visitId ? "viewVisit" : "none";
    case "skipped":
      return (delayReason ?? "").trim() ? "viewSkipReason" : "addSkipReason";
  }
}

export const ACTION_TITLE: Record<Exclude<CycleAction, "none">, string> = {
  createVisit: "Create Visit",
  viewOnWeb: "View on Web",
  viewVisit: "View Visit",
  addSkipReason: "Add Reason and Skip",
  viewSkipReason: "View Reason",
};

export interface PlanView {
  state: PlanState;
  cycles: CycleView[];
  currentIndex: number;
  /** Cycles counted in Progress / Complete / Skipped (the pre-delivery cycle is left out). */
  total: number;
  completeCount: number;
  skippedCount: number;
  progress: number;
  allCyclesPast: boolean;
  previousOverdue: boolean;
  /** The status shown for the current (or last) cycle. */
  cycleStatus: CycleStatus | null;
  action: CycleAction;
}

/**
 * Cycles of one plan in table order, with the counts and the list card's action. `visits` maps a cycle's id to the
 * visit it resolved to (only completed cycles are resolved here).
 */
export function buildPlan(
  state: PlanState,
  raw: RawCycle[],
  isPreCycleRequired: boolean,
  today: string,
  visits: Map<string, string>
): PlanView {
  const sorted = [...raw].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const cycles: CycleView[] = sorted.map((c, i) => {
    const status = cycleStatus(c, today);
    const visitId = visits.get(c.id);
    const action = cycleAction(status, visitId, c.delayReason);
    return {
      number: isPreCycleRequired ? i : i + 1,
      name: c.name,
      start: c.start,
      end: c.end,
      status,
      action,
      secondaryAction: status === "overDue" ? "addSkipReason" : undefined,
      visitId,
    };
  });
  // The first cycle is dropped from the counts when a pre-delivery cycle is required (Cycle 0).
  const counted = isPreCycleRequired ? cycles.slice(1) : cycles;
  const completeCount = counted.filter((c) => c.status === "complete").length;
  const skippedCount = counted.filter((c) => c.status === "skipped").length;
  const total = counted.length;
  const currentIndex = currentCycleIndex(cycles, today);
  const allCyclesPast = cycles.length > 0 && cycles.every((c) => c.end !== null && c.end < today);
  const previousOverdue = cycles.some(
    (c, i) =>
      i !== currentIndex &&
      c.status === "overDue" &&
      !(c.start && c.end && c.start <= today && today <= c.end)
  );
  const shown =
    state === "completed" ? "complete" : currentIndex >= 0 ? cycles[currentIndex].status : null;
  let action: CycleAction = "none";
  if (state === "completed") action = "none";
  else if (state === "notStarted") action = "viewOnWeb";
  else if (currentIndex >= 0) action = cycles[currentIndex].action;
  return {
    state,
    cycles,
    currentIndex,
    total,
    completeCount,
    skippedCount,
    progress: total ? (completeCount + skippedCount) / total : 0,
    allCyclesPast,
    previousOverdue,
    cycleStatus: shown,
    action,
  };
}

/** AccountComplianceCycleSortService: 1 overdue, 2 due in 3 days, 3 in 7, 4 other open, 5 skipped, 6 completed. */
export function cyclePriority(c: Pick<RawCycle, "end" | "status">, today: string): number {
  const raw = (c.status ?? "").trim().toLowerCase();
  if (raw === "completed") return 6;
  if (raw === "skipped") return 5;
  if (!c.end) return 4;
  if (c.end < today) return 1;
  const d = dayDiff(c.end, today);
  if (d <= 3) return 2;
  if (d <= 7) return 3;
  return 4;
}

/** Plans by their best cycle priority, then the soonest end among open cycles, then name; plans without cycles last. */
export function sortPlanIds(
  plans: { id: string; name: string }[],
  cyclesByPlan: Map<string, Pick<RawCycle, "end" | "status">[]>,
  today: string
): string[] {
  const rank = (id: string) => {
    const cs = cyclesByPlan.get(id) ?? [];
    if (!cs.length) return { p: 99, end: "9999-12-31" };
    const p = Math.min(...cs.map((c) => cyclePriority(c, today)));
    const open = cs
      .filter((c) => cyclePriority(c, today) <= 4 && c.end)
      .map((c) => c.end as string);
    return { p, end: open.length ? open.sort()[0] : "9999-12-31" };
  };
  return [...plans]
    .sort((a, b) => {
      const ra = rank(a.id);
      const rb = rank(b.id);
      return ra.p - rb.p || ra.end.localeCompare(rb.end) || a.name.localeCompare(b.name);
    })
    .map((p) => p.id);
}
