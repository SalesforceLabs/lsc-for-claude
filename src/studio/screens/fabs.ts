/** The ••• quick-action menus (FloatingQuickActionButton) — what the viewer's iPad lists on Home and on each record page. */

import { inList, query, type Row } from "../helpers.js";
import type { PublishedLayout, PublishedPage, PublishedComponent, SnapshotCore } from "../published.js";
import type { ScreenContext } from "./context.js";

export interface PublishedFabItem {
  /** The action's API name, for the tooltip. */
  name: string;
  label: string;
}

export interface PublishedFabs {
  /** Home's menu, top to bottom: quick actions by sort order, then custom actions by label. */
  home: PublishedFabItem[];
  /** Record menus by object, then record type name. */
  records: Record<string, Record<string, PublishedFabItem[]>>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** SFActionType.type(for:) (DynamicUI SFActionType): the names the app supports → SFActionType.title; anything else is `.unsupport` and dropped. */
const SUPPORTED_TITLES: Record<string, string> = {
  startremotesession: "Start Remote Session",
  logacall: "Log a Call",
  logavisit: "New Visit",
  newvisit: "New Visit",
  email: "Email",
  lastcall: "Last Call",
  lastvisit: "Last Visit",
  schedulenextvisit: "Schedule Next Visit",
  openchildcall: "Open Child Call",
  viewonline: "View Online",
  viewprofile: "View Profile",
  mirf: "MIRF",
  newquote: "Order",
  createquote: "Order",
  intelligentcontent: "Intelligent Content",
  nbc: "Next Best Customer",
  nextbestcustomer: "Next Best Customer",
  createaccountwithsbc: "Create Account",
  survey: "Survey",
  businessobjective: "Business Objective",
  generatedocument: "Generate Document",
  sharecontent: "Share Content",
  apchangerequest: "Activity Plan Change Request",
  activityplancr: "Activity Plan Change Request",
  activityplanadjustmentrequest: "Activity Plan Change Request",
  createpromoplan: "Create Promo Plan",
  inquiry: "Inquiry",
  changeattendee: "Change Attendee",
  changeaccount: "Change Account",
  signature: "Signature",
  viewconsent: "View Consent",
  captureconsent: "Capture Consent",
  storecheck: "Store Check",
  associatecareprogram: "Associate Care Program",
  createmedicalinsight: "Create Medical Insight",
};

/** Layout action types the factory still builds an action for (SFAccountAction): anything else is `.unsupport`. */
const KEEPS_TYPE = new Set(["", "url", "app", "lightningcomponent", "lightningwebcomponent"]);

/** The key SFActionType and the dedupe use: last dot component, namespace stripped, lower-cased. */
export function actionKey(name: string): string {
  return (name.split(".").pop() ?? name).replace(/^lsc4ce__/i, "").toLowerCase();
}

export const supportedAction = (name: string): boolean => actionKey(name) in SUPPORTED_TITLES;

/** localizedLabel(for: actionName) */
export const actionTitle = (name: string): string | undefined => SUPPORTED_TITLES[actionKey(name)];

export interface HomeQuickAction {
  actionName: string;
  masterLabel: string;
  location: string;
  sortOrder: number;
  profiles: string;
}

export interface HomeCustomAction {
  masterLabel: string;
  entityType: string;
  actionType: string;
}

/**
 * makeHomePageActions (SFFlexiPageView.swift): OCEDBQuickActionModel.fetchHomeActions — HomePage quick
 * actions of NewVisit / Inquiry / ShareContent / Email / CreateQuote for the viewer's profile, by SortOrder —
 * then OCEDBCustomActionModel.fetch(forLocation: .home) by MasterLabel (nocase), deduped by action name.
 * CreateMedicalInsight shows only with the insightCaptureFromAccount setting, which the viewer's setup doesn't turn on here.
 */
export function homeMenu(quick: HomeQuickAction[], custom: HomeCustomAction[], profile: string): PublishedFabItem[] {
  const allowed = new Set(["newvisit", "inquiry", "sharecontent", "email", "createquote"]);
  const q = quick
    .filter((a) => a.location.toLowerCase() === "homepage" && allowed.has(a.actionName.toLowerCase()) && a.profiles.split(";").includes(profile))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => ({ name: a.actionName, label: actionTitle(a.actionName) ?? a.masterLabel }));
  const c = custom
    .filter((a) => a.entityType === "HomePage" && /^(url|utterance|app)$/i.test(a.actionType))
    .sort((a, b) => a.masterLabel.toLowerCase().localeCompare(b.masterLabel.toLowerCase()))
    .map((a) => ({ name: a.masterLabel, label: a.masterLabel }));
  const seen = new Set<string>();
  return [...q, ...c].filter((i) => !seen.has(i.name) && !!seen.add(i.name));
}

export interface LayoutActionItem {
  name: string;
  label: string;
  type: string;
  sortOrder: string;
}

/**
 * SFFlexiPageViewModel.makeActions: the page's dynamic actions (highlightsPanel `actionNames`), else the
 * layout's platform actions; sorted by sortOrder, resolved through SFActionFactory (Unlock is hidden; a
 * layout type other than URL / App / LWC / Aura, or a name SFActionType doesn't know, drops the action),
 * titled by the layout item's label else the type's title, deduped by action name.
 */
export function recordMenu(dynamic: string[] | undefined, items: LayoutActionItem[] | undefined): PublishedFabItem[] {
  const layout = items ?? [];
  const source: LayoutActionItem[] = dynamic
    ? dynamic.map((name) => layout.find((i) => actionKey(i.name) === actionKey(name)) ?? { name, label: "", type: "", sortOrder: "" })
    : layout;
  const order = (s: string) => (s === "" || Number.isNaN(Number(s)) ? Number.MAX_SAFE_INTEGER : Number(s));
  const sorted = dynamic ? source : [...source].sort((a, b) => order(a.sortOrder) - order(b.sortOrder));
  const seen = new Set<string>();
  return sorted
    .filter((i) => !/Account\.(AttendeeCall|ViewProfile)$/.test(i.name) && !/unlock$/i.test(i.name))
    .filter((i) => supportedAction(i.name) && KEEPS_TYPE.has(i.type.toLowerCase()))
    .filter((i) => !seen.has(actionKey(i.name)) && !!seen.add(actionKey(i.name)))
    .map((i) => ({ name: i.name, label: i.label || actionTitle(i.name) || i.name }));
}

const walk = (cs: PublishedComponent[]): string[] | undefined => {
  for (const c of cs) {
    if (c.name.replace(/^.*:/, "") === "highlightsPanel" && c.actions) return c.actions;
    const inner = walk((c.tabs ?? []).flatMap((t) => t.components));
    if (inner) return inner;
  }
  return undefined;
};

function pageActions(page: PublishedPage | undefined): string[] | undefined {
  return page ? walk(page.regions.flatMap((r) => r.components)) : undefined;
}

/** Every object's record types → menu, from the snapshot's flexipages and layouts. */
export function recordMenus(core: Pick<SnapshotCore, "objects" | "pages" | "layouts">): PublishedFabs["records"] {
  const out: PublishedFabs["records"] = {};
  for (const [object, o] of Object.entries(core.objects)) {
    for (const rt of o.recordTypes) {
      const layout: PublishedLayout | undefined = rt.layout ? core.layouts[rt.layout] : undefined;
      const menu = recordMenu(pageActions(rt.flexiPage ? core.pages[rt.flexiPage] : undefined), layout?.actionItems);
      (out[object] ??= {})[rt.name] = menu;
    }
  }
  return out;
}

const FIELD_COLUMNS = "FieldName, PicklistValue, TextValue, IntegerValue";

async function configRecords(category: string, org: string): Promise<{ label: string; fields: Row }[]> {
  const records = await query(
    `SELECT MasterLabel, (SELECT ${FIELD_COLUMNS} FROM LifeSciConfigFieldValues) FROM LifeSciConfigRecord WHERE IsActive = true AND LifeSciConfigCategory.Category IN (${inList([category])})`,
    org,
    true
  );
  const sub = (r: Row, rel: string): Row[] => ((r[rel] as { records?: Row[] } | null)?.records ?? []) as Row[];
  return records.map((r) => ({
    label: str(r.MasterLabel),
    fields: Object.fromEntries(sub(r, "LifeSciConfigFieldValues").map((v) => [str(v.FieldName), v.PicklistValue ?? v.TextValue ?? v.IntegerValue ?? null])),
  }));
}

/**
 * Quick actions carry their audience in a `Profiles` field; custom actions have no audience at all —
 * the org hands every active one to every device (OCEDBCustomActionModel filters by location only).
 */
export async function collectFabs(ctx: ScreenContext): Promise<PublishedFabs> {
  const [quick, custom] = await Promise.all([configRecords("QuickAction", ctx.org), configRecords("CustomAction", ctx.org)]);
  return {
    home: homeMenu(
      quick.map((r) => ({
        actionName: str(r.fields.ActionName),
        masterLabel: r.label,
        location: str(r.fields.Location),
        sortOrder: Number(r.fields.SortOrder ?? 0),
        profiles: str(r.fields.Profiles),
      })),
      custom.map((r) => ({ masterLabel: r.label, entityType: str(r.fields.EntityType), actionType: str(r.fields.ActionType) })),
      ctx.core.profile
    ),
    records: recordMenus(ctx.core),
  };
}
