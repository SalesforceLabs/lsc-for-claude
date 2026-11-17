/**
 * Account Compliance tab (AccountComplianceTabCoordinator, lifesciences-ios OCE/Classes/EPPV): the rep's
 * Provider Engagement compliance action plans with their cycles. Reads the plans and cycles the device syncs
 * (ActionPlan filtered by its DB Schema scope), as the viewer. Read-only.
 */

import { queryByIds, queryResult, type Row } from "../../helpers.js";
import { softFail, type ScreenContext } from "../context.js";
import {
  buildPlan,
  mapPlanState,
  sortPlanIds,
  type CycleAction,
  type CycleStatus,
  type PlanState,
  stateLabel,
  type RawCycle,
} from "./logic.js";

export interface PublishedComplianceCycle {
  number: number;
  name: string;
  start: string | null;
  end: string | null;
  status: CycleStatus;
  action: CycleAction;
  secondaryAction?: CycleAction;
  /** Interviewer and visit date of the completed cycle's visit. */
  interviewer?: string;
  visitDate?: string;
}

export interface PublishedCompliancePlan {
  id: string;
  accountName: string;
  name: string;
  state: PlanState;
  stateLabel: string;
  total: number;
  completeCount: number;
  skippedCount: number;
  progress: number;
  allCyclesPast: boolean;
  previousOverdue: boolean;
  /** The current cycle (the last one when every cycle is past); the card's "Current Cycle" / "Last Cycle" columns. */
  currentCycle?: PublishedComplianceCycle;
  cycleStatus: CycleStatus | null;
  action: CycleAction;
  cycles: PublishedComplianceCycle[];
}

export interface PublishedCompliance {
  /** In the order the iPad lists them. */
  plans: PublishedCompliancePlan[];
  /** The viewer's today (the day the statuses were computed for), `YYYY-MM-DD`. */
  today: string;
  /** The Visit object's label, for "Create Visit". */
  visitLabel?: string;
  /** Why part of the screen isn't drawn from live data. */
  unavailable?: string[];
}

const PLAN_LIMIT = 500;

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const day = (v: unknown): string | null => (typeof v === "string" && v ? v.slice(0, 10) : null);
const field = (row: Row | undefined, key: string): unknown =>
  row?.[Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key];

function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function collectCompliance(
  ctx: ScreenContext
): Promise<PublishedCompliance | undefined> {
  const scope = ctx.scope("ActionPlan");
  if (scope === undefined || scope === null) return undefined;
  const { org } = ctx;
  const today = todayIn(ctx.format.timeZone);

  // ActionPlanDataService: plans of a Provider Engagement compliance template that target an account.
  const where = [
    "ActionPlanTemplateVersion.ActionPlanTemplate.ActionPlanType = 'PrvdEngmtCompliance'",
    "TargetId != null",
    scope ? `(${scope})` : "",
  ]
    .filter(Boolean)
    .join(" AND ");
  const plansRes = await queryResult(
    `SELECT Id, Name, ActionPlanState, TargetId, ActionPlanTemplateVersionId, ActionPlanTemplateVersion.ActionPlanTemplateId FROM ActionPlan WHERE ${where} LIMIT ${PLAN_LIMIT}`,
    org,
    false,
    { allowTruncated: true }
  ).catch((e) => {
    // A missing object or field means the org has no Provider Engagement compliance; the tab stays as the placeholder.
    softFail(ctx, "Account Compliance plans", null)(e);
    return null;
  });
  if (!plansRes) return undefined;
  const planRows = plansRes.records as Row[];
  if (plansRes.truncated || plansRes.totalSize > planRows.length)
    ctx.note(
      `Account Compliance shows the first ${planRows.length} of ${plansRes.totalSize} plans.`
    );

  const unavailable: string[] = [];
  const overrides: Record<string, string> = {};
  const cfg = await ctx
    .config(["PrvdEngmtComplianceSettings"])
    .catch(() => ({}) as Record<string, Row>);
  const settings = cfg.PrvdEngmtComplianceSettings;
  for (const key of ["completed", "inprogress", "notstarted", "stopped", "restarted"]) {
    const v = s(field(settings, `actionplan_actionplanstate_${key}`));
    if (v) overrides[{ inprogress: "inProgress", notstarted: "notStarted" }[key] ?? key] = v;
  }

  const planIds = planRows.map((p) => s(p.Id));
  const accountIds = [...new Set(planRows.map((p) => s(p.TargetId)).filter(Boolean))];
  const templateIds = [
    ...new Set(
      planRows
        .map((p) =>
          s(field(p.ActionPlanTemplateVersion as Row | undefined, "ActionPlanTemplateId"))
        )
        .filter(Boolean)
    ),
  ];
  const [accounts, cycleRows, templates] = await Promise.all([
    queryByIds("Id, Name", "Account", "Id", accountIds, org).catch(
      softFail(ctx, "Account Compliance accounts", [] as Row[])
    ),
    queryByIds(
      "Id, Name, ActionPlanId, EffectiveStartDate, EffectiveEndDate, Status, ActionDelayReason, CompletionAssessmentTaskId",
      "PrvdEngmtComplianceCycle",
      "ActionPlanId",
      planIds,
      org
    ).catch(async (e) => {
      // Older orgs lack the delay-reason and completion-task fields; read the dates and status alone.
      try {
        return await queryByIds(
          "Id, Name, ActionPlanId, EffectiveStartDate, EffectiveEndDate, Status",
          "PrvdEngmtComplianceCycle",
          "ActionPlanId",
          planIds,
          org
        );
      } catch {
        softFail(ctx, "Account Compliance cycles", [] as Row[])(e);
        unavailable.push("Cycles couldn't be read, so progress and the cycle table are empty.");
        return [] as Row[];
      }
    }),
    queryByIds("Id, IsPreCycleRequired", "ActionPlanTemplate", "Id", templateIds, org).catch(
      softFail(ctx, "Account Compliance templates", [] as Row[])
    ),
  ]);
  const accountName = new Map(accounts.map((a) => [s(a.Id), s(a.Name)]));
  const preCycle = new Map(templates.map((t) => [s(t.Id), t.IsPreCycleRequired === true]));

  // View Visit / interviewer / date: only a completed cycle's visit is resolved, through its completion assessment task.
  const taskIds = [
    ...new Set(cycleRows.map((c) => s(c.CompletionAssessmentTaskId)).filter(Boolean)),
  ];
  const tasks = taskIds.length
    ? await queryByIds("Id, ParentId, AssignedTo.Name", "AssessmentTask", "Id", taskIds, org).catch(
        softFail(ctx, "Account Compliance visits", [] as Row[])
      )
    : [];
  const visitIds = [...new Set(tasks.map((t) => s(t.ParentId)).filter(Boolean))];
  const visits = visitIds.length
    ? await queryByIds("Id, PlannedVisitStartTime", "Visit", "Id", visitIds, org).catch(
        softFail(ctx, "Account Compliance visits", [] as Row[])
      )
    : [];
  const visitDate = new Map(visits.map((v) => [s(v.Id), day(v.PlannedVisitStartTime)]));
  const taskByCycle = new Map<string, { visitId: string; interviewer: string }>();
  for (const t of tasks) {
    taskByCycle.set(s(t.Id), {
      visitId: s(t.ParentId),
      interviewer: s(field(t.AssignedTo as Row | undefined, "Name")),
    });
  }

  const rawByPlan = new Map<string, RawCycle[]>();
  for (const c of cycleRows) {
    const list = rawByPlan.get(s(c.ActionPlanId)) ?? [];
    list.push({
      id: s(c.Id),
      name: s(c.Name),
      start: day(c.EffectiveStartDate),
      end: day(c.EffectiveEndDate),
      status: s(c.Status) || null,
      delayReason: s(c.ActionDelayReason) || null,
      completionTaskId: s(c.CompletionAssessmentTaskId) || null,
    });
    rawByPlan.set(s(c.ActionPlanId), list);
  }

  const views = new Map<string, PublishedCompliancePlan>();
  for (const p of planRows) {
    const id = s(p.Id);
    const raw = rawByPlan.get(id) ?? [];
    const visitOf = new Map<string, string>();
    for (const c of raw) {
      const t = c.completionTaskId ? taskByCycle.get(c.completionTaskId) : undefined;
      if (t?.visitId) visitOf.set(c.id, t.visitId);
    }
    const tmpl = s(field(p.ActionPlanTemplateVersion as Row | undefined, "ActionPlanTemplateId"));
    const state = mapPlanState(s(p.ActionPlanState), overrides);
    const plan = buildPlan(state, raw, preCycle.get(tmpl) === true, today, visitOf);
    const sortedRaw = [...raw].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    const cycles: PublishedComplianceCycle[] = plan.cycles.map((c, i) => {
      const t = taskByCycle.get(sortedRaw[i].completionTaskId ?? "");
      return {
        number: c.number,
        name: c.name,
        start: c.start,
        end: c.end,
        status: c.status,
        action: c.action,
        secondaryAction: c.secondaryAction,
        interviewer: t?.interviewer || undefined,
        visitDate: (t && visitDate.get(t.visitId)) || undefined,
      };
    });
    views.set(id, {
      id,
      accountName: accountName.get(s(p.TargetId)) ?? "",
      name: s(p.Name),
      state,
      stateLabel: "",
      total: plan.total,
      completeCount: plan.completeCount,
      skippedCount: plan.skippedCount,
      progress: plan.progress,
      allCyclesPast: plan.allCyclesPast,
      previousOverdue: plan.previousOverdue,
      currentCycle: plan.currentIndex >= 0 ? cycles[plan.currentIndex] : undefined,
      cycleStatus: plan.cycleStatus,
      action: plan.action,
      cycles,
    });
  }
  for (const v of views.values()) v.stateLabel = stateLabel(v.state);

  const order = sortPlanIds(
    planRows.map((p) => ({ id: s(p.Id), name: s(p.Name) })),
    rawByPlan,
    today
  );
  unavailable.push(
    "Whether an open cycle already has a visit (View Visit instead of Create Visit) isn't resolved; its button is drawn as Create Visit."
  );
  return { plans: order.map((id) => views.get(id)!), today, unavailable };
}
