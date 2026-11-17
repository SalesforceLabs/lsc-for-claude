import type {
  ComplianceCycleAction,
  ComplianceCycleStatus,
  CompliancePlanState,
  PublishedCompliancePlan,
} from "./compliance-types";

export type ComplianceTab = "all" | "notStarted" | "inProgress" | "completed";

export const TABS: { id: ComplianceTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "notStarted", label: "Not Started" },
  { id: "inProgress", label: "In Progress" },
  { id: "completed", label: "Completed" },
];

/** The status tabs map the three states only; stopped and restarted plans show under All (ActionPlanStateMapper). */
export function filterPlans(
  plans: PublishedCompliancePlan[],
  tab: ComplianceTab,
  search: string
): PublishedCompliancePlan[] {
  const q = search.trim().toLowerCase();
  return plans.filter(
    (p) =>
      (tab === "all" || p.state === tab) &&
      (!q || p.accountName.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
  );
}

/** AccountComplianceListViewModel empty-state messages. */
export function emptyMessage(tab: ComplianceTab): string {
  if (tab === "all") return "When you have Account Compliance records, you'll find them here.";
  const label = TABS.find((t) => t.id === tab)!.label;
  return `When any Account Compliance record is in the ${label} state, you'll find it here.`;
}

/** Cycle status badge title and tone (the status badge enum in lifesciences-ios). */
export const STATUS_BADGE: Record<
  ComplianceCycleStatus,
  { title: string; tone: "warning" | "info" | "success" | "neutral" | "error" }
> = {
  dueSoon: { title: "Due Soon", tone: "warning" },
  upcoming: { title: "Upcoming", tone: "info" },
  complete: { title: "Complete", tone: "success" },
  notStarted: { title: "Not Started", tone: "neutral" },
  skipped: { title: "Skipped", tone: "error" },
  overDue: { title: "Overdue", tone: "error" },
};

export function actionTitle(action: ComplianceCycleAction, visitLabel = "Visit"): string | null {
  switch (action) {
    case "createVisit":
      return `Create ${visitLabel}`;
    case "viewOnWeb":
      return "View on Web";
    case "viewVisit":
      return `View ${visitLabel}`;
    case "addSkipReason":
      return "Add Reason and Skip";
    case "viewSkipReason":
      return "View Reason";
    default:
      return null;
  }
}

/** Stopped and restarted plans keep their state label as the bordered status; tone follows the state. */
export function stateTone(state: CompliancePlanState): "neutral" | "info" | "success" | "error" {
  return state === "completed"
    ? "success"
    : state === "stopped"
      ? "error"
      : state === "notStarted"
        ? "neutral"
        : "info";
}

export function shortDate(d: string | null | undefined, locale = "en-US"): string {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return "-";
  return new Date(y, m - 1, day).toLocaleDateString(locale, { month: "long", day: "numeric" });
}
