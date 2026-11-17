/**
 * Key Account Management plan pages (lifesciences-ios module/KAM, flag KAM.NewComponents on: the accordion).
 * The Account Plan and Territory Business Plan record pages draw Objectives -> Action Plans -> Tactics, the
 * Stakeholders tab and the Participants tab. The collector reads the plans the rep can have on the device
 * (a recent sample, not every plan) and the record page looks its own record up in `plans`.
 */

import { chunkIds } from "../../../tools/helpers.js";
import { inList, query, queryByIds, type Row } from "../../helpers.js";
import { softFail, type ScreenContext } from "../context.js";
import {
  dueDay,
  newestFirst,
  nomenclatureOf,
  progressMode,
  statusKind,
  type KamNomenclature,
  type ProgressDisplayMode,
  type StatusKind,
} from "./logic.js";

export type { KamNomenclature, ProgressDisplayMode, StatusKind };

export interface KamTask {
  id: string;
  name: string;
  status: string | null;
  kind: StatusKind;
  owner: string | null;
  assignedTo: string | null;
  /** ISO day. */
  dueDate: string | null;
}

export interface KamActionPlan {
  id: string;
  title: string;
  status: string | null;
  kind: StatusKind;
  percent: number;
  owner: string | null;
  tasks: KamTask[];
}

export interface KamObjective {
  id: string;
  title: string;
  status: string | null;
  kind: StatusKind;
  percent: number;
  owner: string | null;
  assignedTo: string | null;
  products: string[];
  actionPlans: KamActionPlan[];
}

export interface KamStakeholder {
  id: string;
  /** The account's name, else the stakeholder's own name. */
  title: string;
  nonProfiled: boolean;
  role: string | null;
  influence: string | null;
  strength: string | null;
  /** The stakeholder's Comment, when the object has the field. */
  comment?: string | null;
  /** Team members linked to this stakeholder (AcctPlanPtcpStakeholder rows), by participant name. */
  members?: string[];
}

export interface KamParticipant {
  id: string;
  name: string;
  /** The participant's role (ParticipantRole.MasterLabel). */
  role?: string | null;
}

export interface KamPlan {
  object: "AccountPlan" | "TerritoryBusinessPlan";
  /** Territory Business Plans carry their name for the import picker. */
  name?: string;
  objectives: KamObjective[];
  /** Account plans only; undefined when the device doesn't sync the table. */
  stakeholders?: KamStakeholder[];
  participants?: KamParticipant[];
  /** What was cut short for this plan, in words. */
  cut?: string[];
}

export interface PublishedKam {
  plans: Record<string, KamPlan>;
  mode: ProgressDisplayMode;
  nomenclature: KamNomenclature;
  /** True when the org's KAMConfigurations setting was read; false when the preview used the defaults. */
  configRead: boolean;
  /** The KAM tables the device syncs for this viewer, for reading a plan outside the list on demand (studio_kam_plan). */
  sync: string[];
  /** Promo Plan templates (AccountPlan, record type PromoPlanTemplate) the Create Promo Plan action lists. */
  promoTemplates?: { id: string; name: string; status: string | null }[];
}

const KAM_TABLES = [
  "AccountPlan",
  "TerritoryBusinessPlan",
  "AccountPlanObjective",
  "GoalAssignment",
  "ActionPlan",
  "AssessmentTask",
  "AccountPlanStakeholder",
  "AccountPlanParticipant",
  "AcctPlanPtcpStakeholder",
];

const MAX_PLANS = 25;
const MAX_TASKS = 1500;
const MAX_ROWS = 2000;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;

export async function collectKam(ctx: ScreenContext): Promise<PublishedKam | undefined> {
  const sync = (t: string) => ctx.scope(t) !== undefined;
  const accountPlans = sync("AccountPlan");
  const territoryPlans = sync("TerritoryBusinessPlan");
  if (!accountPlans && !territoryPlans) return undefined; // the device doesn't sync KAM plans

  const where = (table: string): string => {
    const sc = ctx.scope(table);
    if (sc === null) {
      ctx.note(
        `Key Account Management: the ${table} sync filter can't be reproduced here, so every ${table} the rep can read is shown.`
      );
      return "";
    }
    return sc ? ` AND (${sc})` : "";
  };

  const [setting] = await Promise.all([readSetting(ctx)]);

  const [ap, tp] = await Promise.all([
    accountPlans
      ? query(
          `SELECT Id FROM AccountPlan WHERE Id != null${where("AccountPlan")} ORDER BY LastModifiedDate DESC LIMIT ${MAX_PLANS}`,
          ctx.org
        ).catch(softFail(ctx, "Account plans", [] as Row[]))
      : [],
    territoryPlans
      ? query(
          `SELECT Id, Name FROM TerritoryBusinessPlan WHERE Id != null${where("TerritoryBusinessPlan")} ORDER BY LastModifiedDate DESC LIMIT ${MAX_PLANS}`,
          ctx.org
        ).catch(softFail(ctx, "Territory plans", [] as Row[]))
      : [],
  ]);
  const apIds = ap.map((r) => String(r.Id));
  const tpIds = tp.map((r) => String(r.Id));
  if (ap.length >= MAX_PLANS || tp.length >= MAX_PLANS)
    ctx.note(
      `Key Account Management: showing the ${MAX_PLANS} most recently changed plans of each kind.`
    );

  const plans = await readPlans(ctx, apIds, tpIds, where, sync);
  for (const r of tp) {
    const p = plans[String(r.Id)];
    if (p && str(r.Name)) p.name = str(r.Name) ?? undefined;
  }
  // KAMPromoPlanDataService.initalFilters: record type PromoPlanTemplate (the account's cluster attributes also narrow it on the device).
  const scope = ctx.scope("AccountPlan");
  const templates = accountPlans
    ? await query(
        `SELECT Id, Name, Status FROM AccountPlan WHERE RecordType.DeveloperName = 'PromoPlanTemplate'${scope ? ` AND (${scope})` : ""} ORDER BY Name LIMIT 50`,
        ctx.org
      ).catch(softFail(ctx, "Promo plan templates", [] as Row[]))
    : [];
  return {
    plans,
    promoTemplates: templates.length
      ? templates.map((r) => ({ id: String(r.Id), name: str(r.Name) ?? "", status: str(r.Status) }))
      : undefined,
    mode: progressMode(setting?.ProgressDisplayMode),
    nomenclature: nomenclatureOf(setting),
    configRead: !!setting,
    sync: KAM_TABLES.filter(sync),
  };
}

/** The org's KAM settings, for the on-demand plan read. */
export { readSetting as readKamSetting };

/**
 * One plan the list didn't include, read on demand as the connected account (the device's sync filters can't be
 * applied without the viewer's snapshot, so `sync` lists the tables to read and every row the account can see is shown).
 */
export async function readKamPlan(
  ctx: ScreenContext,
  object: "AccountPlan" | "TerritoryBusinessPlan",
  id: string
): Promise<KamPlan | undefined> {
  const sync = (t: string) => ctx.scope(t) !== undefined;
  const plans = await readPlans(
    ctx,
    object === "AccountPlan" ? [id] : [],
    object === "TerritoryBusinessPlan" ? [id] : [],
    () => "",
    sync
  );
  return plans[id];
}

async function readPlans(
  ctx: ScreenContext,
  apIds: string[],
  tpIds: string[],
  where: (table: string) => string,
  sync: (t: string) => boolean
): Promise<Record<string, KamPlan>> {
  const plans: Record<string, KamPlan> = {};
  // Level 1: Account Plan Objectives / Territory Goal Assignments.
  const objRows: Row[] = [];
  if (apIds.length && sync("AccountPlanObjective")) {
    objRows.push(
      ...(await queryByIds(
        "Id, Name, Status, OwnerId, ObjectiveOwnerId, ActionPlanCompletedPct, LastModifiedDate, AccountPlanId",
        "AccountPlanObjective",
        "AccountPlanId",
        apIds,
        ctx.org,
        where("AccountPlanObjective").replace(/^ AND /, "") || undefined
      ).catch(softFail(ctx, "Objectives", [] as Row[])))
    );
  }
  const gaRows: Row[] = [];
  if (tpIds.length && sync("GoalAssignment")) {
    gaRows.push(
      ...(await queryByIds(
        "Id, Name, Status, GoalAssigneeId, CompletionPercentage, LastModifiedDate, ParentRecordId",
        "GoalAssignment",
        "ParentRecordId",
        tpIds,
        ctx.org,
        where("GoalAssignment").replace(/^ AND /, "") || undefined
      ).catch(softFail(ctx, "Goal assignments", [] as Row[])))
    );
  }

  // Level 2: Action Plans of those.
  const parentIds = [...objRows, ...gaRows].map((r) => String(r.Id));
  const apRows =
    parentIds.length && sync("ActionPlan")
      ? await queryByIds(
          "Id, Name, ActionPlanState, OwnerId, CompletedPercentage, LastModifiedDate, TargetId",
          "ActionPlan",
          "TargetId",
          parentIds,
          ctx.org,
          where("ActionPlan").replace(/^ AND /, "") || undefined
        ).catch(softFail(ctx, "Action plans", [] as Row[]))
      : [];

  // Level 3: tactics.
  const planIds = apRows.map((r) => String(r.Id));
  let taskRows: Row[] = [];
  if (planIds.length && sync("AssessmentTask")) {
    const w = where("AssessmentTask");
    const chunks = chunkIds(planIds);
    const out: Row[] = [];
    for (const chunk of chunks) {
      if (out.length >= MAX_TASKS) break;
      const rows = await query(
        `SELECT Id, Name, Status, OwnerId, AssignedToId, DueDate, ReferenceRecordId FROM AssessmentTask WHERE ReferenceRecordId IN (${inList(chunk)})${w} LIMIT ${MAX_TASKS - out.length}`,
        ctx.org
      ).catch(softFail(ctx, "Tactics", [] as Row[]));
      out.push(...rows);
    }
    taskRows = out;
    if (taskRows.length >= MAX_TASKS)
      ctx.note(
        `Key Account Management: read the first ${MAX_TASKS} tactics; later ones are missing.`
      );
  }

  // Products per objective (AccountPlanProduct rows tied to an objective).
  const productRows =
    apIds.length && sync("AccountPlanProduct")
      ? await queryByIds(
          "ProductId, AccountPlanObjectiveId",
          "AccountPlanProduct",
          "AccountPlanId",
          apIds,
          ctx.org,
          "AccountPlanObjectiveId != null"
        ).catch(softFail(ctx, "Plan products", [] as Row[]))
      : [];

  // Stakeholders and participants (account plans).
  const shRows =
    apIds.length && sync("AccountPlanStakeholder")
      ? await queryByIds(
          "Id, Name, StakeholderName, StakeholderRefnRecordId, RoleType, InfluenceLevel, Strength, Comment, AccountPlanId",
          "AccountPlanStakeholder",
          "AccountPlanId",
          apIds,
          ctx.org
        ).catch(softFail(ctx, "Stakeholders", [] as Row[]))
      : [];
  const partRows =
    apIds.length && sync("AccountPlanParticipant")
      ? await queryByIds(
          "Id, Name, ParticipantId, ParticipantRoleId, AccountPlanId",
          "AccountPlanParticipant",
          "AccountPlanId",
          apIds,
          ctx.org
        ).catch(softFail(ctx, "Participants", [] as Row[]))
      : [];

  // Team members linked to each stakeholder (AcctPlanPtcpStakeholder: AccountPlanMemberStakeholder in the app).
  const linkRows =
    shRows.length && sync("AcctPlanPtcpStakeholder")
      ? await queryByIds(
          "Id, AccountPlanStakeholderId, AccountPlanParticipantId",
          "AcctPlanPtcpStakeholder",
          "AccountPlanStakeholderId",
          shRows.map((r) => String(r.Id)),
          ctx.org
        ).catch(softFail(ctx, "Stakeholder team members", [] as Row[]))
      : [];

  // Names: users (owners, assignees, participants), accounts (stakeholders), products.
  const userIds = new Set<string>();
  for (const r of [...objRows, ...gaRows, ...apRows, ...taskRows, ...partRows]) {
    for (const k of [
      "OwnerId",
      "ObjectiveOwnerId",
      "GoalAssigneeId",
      "AssignedToId",
      "ParticipantId",
    ]) {
      const v = str(r[k]);
      if (v?.startsWith("005")) userIds.add(v);
    }
  }
  const accountIds = [
    ...new Set(shRows.map((r) => str(r.StakeholderRefnRecordId)).filter((v): v is string => !!v)),
  ];
  const productIds = [
    ...new Set(productRows.map((r) => str(r.ProductId)).filter((v): v is string => !!v)),
  ];
  const roleIds = [
    ...new Set(partRows.map((r) => str(r.ParticipantRoleId)).filter((v): v is string => !!v)),
  ];
  const [users, accounts, products, roles] = await Promise.all([
    names("User", [...userIds], ctx),
    names("Account", accountIds, ctx),
    productNames(productIds, ctx),
    roleLabels(roleIds, ctx),
  ]);

  const tasksBy = group(taskRows, "ReferenceRecordId");
  const plansBy = group(apRows, "TargetId");
  const productsBy = group(productRows, "AccountPlanObjectiveId");

  const actionPlansOf = (parentId: string): KamActionPlan[] =>
    newestFirst(
      (plansBy.get(parentId) ?? []).map((p) => ({ modified: String(p.LastModifiedDate ?? ""), p }))
    ).map(({ p }) => {
      const raw = str(p.ActionPlanState);
      return {
        id: String(p.Id),
        title: str(p.Name) ?? "",
        status: raw,
        kind: statusKind(raw),
        percent: num(p.CompletedPercentage),
        owner: users.get(str(p.OwnerId) ?? "") ?? null,
        tasks: (tasksBy.get(String(p.Id)) ?? []).map((t) => {
          const tRaw = str(t.Status);
          return {
            id: String(t.Id),
            name: str(t.Name) ?? "",
            status: tRaw,
            kind: statusKind(tRaw),
            owner: users.get(str(t.OwnerId) ?? "") ?? null,
            assignedTo: users.get(str(t.AssignedToId) ?? "") ?? null,
            dueDate: dueDay(t.DueDate),
          };
        }),
      };
    });

  for (const id of apIds)
    plans[id] = {
      object: "AccountPlan",
      objectives: [],
      stakeholders: sync("AccountPlanStakeholder") ? [] : undefined,
      participants: sync("AccountPlanParticipant") ? [] : undefined,
    };
  for (const id of tpIds) plans[id] = { object: "TerritoryBusinessPlan", objectives: [] };

  for (const { r, plan, assignee } of [
    ...newestFirst(objRows.map((r) => ({ modified: String(r.LastModifiedDate ?? ""), r }))).map(
      ({ r }) => ({ r, plan: String(r.AccountPlanId), assignee: str(r.ObjectiveOwnerId) })
    ),
    ...newestFirst(gaRows.map((r) => ({ modified: String(r.LastModifiedDate ?? ""), r }))).map(
      ({ r }) => ({ r, plan: String(r.ParentRecordId), assignee: str(r.GoalAssigneeId) })
    ),
  ]) {
    const isGoal = "ParentRecordId" in r;
    const raw = str(r.Status);
    plans[plan]?.objectives.push({
      id: String(r.Id),
      title: str(r.Name) ?? "",
      status: raw,
      kind: statusKind(raw),
      percent: num(isGoal ? r.CompletionPercentage : r.ActionPlanCompletedPct),
      owner: isGoal ? null : (users.get(str(r.OwnerId) ?? "") ?? null),
      assignedTo: assignee ? (users.get(assignee) ?? null) : null,
      products: [
        ...new Set(
          (productsBy.get(String(r.Id)) ?? [])
            .map((p) => products.get(str(p.ProductId) ?? ""))
            .filter((n): n is string => !!n)
        ),
      ],
      actionPlans: actionPlansOf(String(r.Id)),
    });
  }

  const nameOfParticipant = new Map(
    partRows.map((p) => [String(p.Id), users.get(str(p.ParticipantId) ?? "") ?? ""])
  );
  const membersBy = new Map<string, string[]>();
  for (const l of linkRows) {
    const n = nameOfParticipant.get(str(l.AccountPlanParticipantId) ?? "");
    const k = str(l.AccountPlanStakeholderId);
    if (n && k) membersBy.set(k, [...(membersBy.get(k) ?? []), n]);
  }

  for (const s of shRows) {
    const accountId = str(s.StakeholderRefnRecordId);
    const account = accountId ? accounts.get(accountId) : undefined;
    plans[String(s.AccountPlanId)]?.stakeholders?.push({
      id: String(s.Id),
      // StakeholdersTabViewModel.stakeholderTitle: the account's name, else the stakeholder's own name.
      title: account ?? str(s.StakeholderName) ?? str(s.Name) ?? "",
      nonProfiled: !account,
      role: str(s.RoleType),
      influence: str(s.InfluenceLevel),
      strength: str(s.Strength),
      comment: str(s.Comment),
      members: (membersBy.get(String(s.Id)) ?? []).filter((n, i, a) => a.indexOf(n) === i),
    });
  }
  for (const p of partRows) {
    const name = users.get(str(p.ParticipantId) ?? "");
    if (name)
      plans[String(p.AccountPlanId)]?.participants?.push({
        id: String(p.Id),
        name,
        role: roles.get(str(p.ParticipantRoleId) ?? "") ?? null,
      });
  }

  return plans;
}

/** The KAMConfigurations custom setting (hierarchy setting: the first row is the org default). Missing = the defaults. */
async function readSetting(ctx: ScreenContext): Promise<Row | undefined> {
  const fields =
    "ProgressDisplayMode, NomenclatureObjective, NomenclatureObjectivePlural, NomenclatureActionPlan, NomenclatureActionPlanPlural, NomenclatureTactic, NomenclatureTacticPlural";
  for (const name of ["KAMConfigurations__c", "KAMConfigurations"]) {
    const rows = await query(
      `SELECT ${fields
        .split(", ")
        .map((f) => (name.endsWith("__c") ? `${f}__c` : f))
        .join(", ")} FROM ${name} LIMIT 1`,
      ctx.org
    ).catch(() => undefined);
    if (rows?.[0]) {
      // Custom fields carry __c; hand the logic plain names.
      return Object.fromEntries(
        Object.entries(rows[0]).map(([k, v]) => [k.replace(/__c$/, ""), v])
      );
    }
  }
  return undefined;
}

function group(rows: Row[], key: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = str(r[key]);
    if (k) out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

async function names(
  object: string,
  ids: string[],
  ctx: ScreenContext
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await queryByIds("Id, Name", object, "Id", ids.slice(0, MAX_ROWS), ctx.org).catch(
    softFail(ctx, `${object} names`, [] as Row[])
  );
  for (const r of rows) out.set(String(r.Id), String(r.Name ?? ""));
  return out;
}

/** PlanHierarchyRecordHelpers.fetchProductNames: a product, marketable product or category name. */
async function productNames(ids: string[], ctx: ScreenContext): Promise<Map<string, string>> {
  const out = await names("Product2", ids, ctx);
  const rest = ids.filter((i) => !out.has(i));
  if (rest.length)
    for (const [k, v] of await names("LifeSciMarketableProduct", rest, ctx)) out.set(k, v);
  return out;
}

/** ParticipantRole labels (the role picker's choices on the device). */
async function roleLabels(ids: string[], ctx: ScreenContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await queryByIds("Id, MasterLabel", "ParticipantRole", "Id", ids, ctx.org).catch(
    softFail(ctx, "Participant roles", [] as Row[])
  );
  for (const r of rows) out.set(String(r.Id), String(r.MasterLabel ?? ""));
  return out;
}
