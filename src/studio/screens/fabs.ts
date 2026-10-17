/** The ••• quick-action menus (FloatingQuickActionButton) — what the viewer's iPad lists on Home and on each record page. */

import { inList, query, type Row } from "../helpers.js";
import type { PublishedLayout, PublishedPage, PublishedComponent, SnapshotCore } from "../published.js";
import type { ScreenContext } from "./context.js";
import { accountWhere, CARD_CAP, formatAddress } from "./accounts.js";

/** What a custom action (or a layout's URL / App / LWC action) targets — enough to say what the app would open. */
export interface PublishedFabAction {
  /** Lower-cased ActionType: url, app, utterance, flow, lightningcomponent, … */
  type: string;
  /** ActionTarget: the URL, utterance, or component. */
  target?: string;
  /** TargetType: internal / inline / external. */
  targetType?: string;
  /** HideViewInBrowserAction: the in-app browser has no Safari button. */
  hideBrowser?: boolean;
}

export interface PublishedFabItem {
  /** The action's API name, for the tooltip. */
  name: string;
  label: string;
  /** Present on custom actions and layout URL / App / component actions. */
  action?: PublishedFabAction;
}

/** A License badge on the visit editor's Place box. */
export type LicenseState = "valid" | "invalid";

/** What the New Visit editor needs about one account: the sub-label under its name, its default place and the badges. */
export interface VisitCreateAccount {
  /** Person account (HCP): draws the person-account icon and the license badges; an HCO draws the HCO icon. */
  person: boolean;
  /** HealthcareProvider.ProfessionalTitle for a person, the record type label for an HCO. */
  subLabel?: string;
  /** The default Place (preferredContactPointAddress), formatted like the device. */
  place?: { id: string; text: string };
  licenses?: { state?: LicenseState; dea?: LicenseState; sdl?: LicenseState };
}

/** Inputs of VisitHeaderViewModel's defaults and its lookups (visit create from an account). */
export interface PublishedVisitCreate {
  /** The viewer's current territory name (Territory defaults to it). */
  territory?: string;
  /** ProviderVisitSettings.DefaultVisitDuration (30 when unset). */
  durationMinutes: number;
  /** ProviderVisitSettings.SetBlankDateTimeInPlannedStartTime: Planned Start and End open empty. */
  blankStart: boolean;
  accounts: Record<string, VisitCreateAccount>;
}

export interface PublishedFabs {
  /** New Visit from an account. */
  visitCreate?: PublishedVisitCreate;
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
  actionTarget?: string;
  targetType?: string;
  hideBrowser?: boolean;
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
    .map((a) => ({
      name: a.masterLabel,
      label: a.masterLabel,
      action: { type: a.actionType.toLowerCase(), target: a.actionTarget || undefined, targetType: a.targetType || undefined, hideBrowser: a.hideBrowser || undefined },
    }));
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
    .map((i) => ({ name: i.name, label: i.label || actionTitle(i.name) || i.name, ...(i.type ? { action: { type: i.type.toLowerCase() } } : {}) }));
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

const FIELD_COLUMNS = "FieldName, PicklistValue, TextValue, IntegerValue, HasBooleanValue, LongTextValue, UrlValue";

export async function configRecords(category: string, org: string): Promise<{ label: string; fields: Row }[]> {
  const records = await query(
    `SELECT MasterLabel, (SELECT ${FIELD_COLUMNS} FROM LifeSciConfigFieldValues) FROM LifeSciConfigRecord WHERE IsActive = true AND LifeSciConfigCategory.Category IN (${inList([category])})`,
    org,
    true
  );
  const sub = (r: Row, rel: string): Row[] => ((r[rel] as { records?: Row[] } | null)?.records ?? []) as Row[];
  return records.map((r) => ({
    label: str(r.MasterLabel),
    fields: Object.fromEntries(sub(r, "LifeSciConfigFieldValues").map((v) => [str(v.FieldName), v.PicklistValue ?? v.TextValue ?? v.LongTextValue ?? v.UrlValue ?? v.IntegerValue ?? v.HasBooleanValue ?? null])),
  }));
}

interface PlaceRow {
  Id: string;
  IsPrimary?: boolean;
  LastModifiedDate?: string;
  [k: string]: unknown;
}

/**
 * OCEDBAccountModel.preferedContactPointAddress: the territory info's PreferredAddressId when that address is
 * active, else the active primary address (most recently updated), else the most recently updated active one.
 */
export function defaultPlace<T extends PlaceRow>(addresses: T[], preferredIds: string[]): T | undefined {
  const recent = (a: T[]) => [...a].sort((x, y) => str(y.LastModifiedDate).localeCompare(str(x.LastModifiedDate)));
  return addresses.find((a) => preferredIds.includes(a.Id)) ?? recent(addresses.filter((a) => a.IsPrimary === true))[0] ?? recent(addresses)[0];
}

/** LicenseValidator: a badge exists only when its setting is on (SDL: and the state needs it); green when the license is validated, else red. */
export function licenseBadge(enabled: boolean, license: Row | undefined, field: string): LicenseState | undefined {
  if (!enabled) return undefined;
  return license && (field ? license[field] === true : license.IsLicenseValidated === true) ? "valid" : "invalid";
}

const configKey = (row: Row | undefined, key: string): unknown => row?.[Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key];

async function collectVisitCreate(ctx: ScreenContext): Promise<PublishedVisitCreate | undefined> {
  const { org } = ctx;
  const cfg = await ctx.config(["ProviderVisitSettings", "StateLicenseNumberSettings", "DEASettings", "StateDistributorLicenseSettings"]).catch(() => ({}) as Record<string, Row>);
  const duration = Number(configKey(cfg.ProviderVisitSettings, "DefaultVisitDuration"));
  const result: PublishedVisitCreate = {
    // The editor shows TerritoryService.selectedTerritory (the territory picked on the device, defaulting to the user's first);
    // a user with several territories can have a different one selected, which the org cannot tell.
    territory: ctx.territories[0]?.name,
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 30,
    blankStart: configKey(cfg.ProviderVisitSettings, "SetBlankDateTimeInPlannedStartTime") === true,
    accounts: {},
  };
  const scope = ctx.scope("Account");
  if (scope === undefined || scope === null) return result;
  const field = (row: Row | undefined, key: string) => {
    const v = str(configKey(row, key));
    return /^\w+$/.test(v) ? v : "";
  };
  const slnOn = configKey(cfg.StateLicenseNumberSettings, "IsEnabledOnLogACall") === true;
  const slnField = field(cfg.StateLicenseNumberSettings, "SlnValFormulaField");
  const deaOn = configKey(cfg.DEASettings, "IsDEALicensingEnabled") === true;
  const deaField = field(cfg.DEASettings, "DEAValidationFormulaField");
  const sdlOn = configKey(cfg.StateDistributorLicenseSettings, "IsTDDDLicensingEnabled") === true;
  const sdlField = field(cfg.StateDistributorLicenseSettings, "TDDFormulaField");
  const sdlStates = str(configKey(cfg.StateDistributorLicenseSettings, "TDDDStates")).split(";").filter(Boolean);

  const accounts = await query(`SELECT Id, RecordType.Name, RecordType.IsPersonType FROM Account${accountWhere(scope)} ORDER BY Name ASC NULLS LAST LIMIT ${CARD_CAP}`, org).catch(() => [] as Row[]);
  const ids = accounts.map((a) => str(a.Id));
  if (!ids.length) return result;
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) parts.push(ids.slice(i, i + 150));
  const run = async (build: (inIds: string) => string): Promise<Row[]> => (await Promise.all(parts.map((p) => query(build(inList(p)), org).catch(() => [] as Row[])))).flat();
  const territoryIds = ctx.territories.map((t) => t.id);
  const [titles, atis, addresses] = await Promise.all([
    run((inIds) => `SELECT AccountId, toLabel(ProfessionalTitle) FROM HealthcareProvider WHERE AccountId IN (${inIds})`),
    territoryIds.length ? run((inIds) => `SELECT AccountId, PreferredAddressId FROM ProviderAcctTerritoryInfo WHERE AccountId IN (${inIds}) AND Territory2Id IN (${inList(territoryIds)})`) : Promise.resolve([] as Row[]),
    run((inIds) => `SELECT Id, ParentId, Street, PostalCode, City, State, StateCode, Country, IsPrimary, LastModifiedDate FROM ContactPointAddress WHERE ParentId IN (${inIds}) AND IsActive = true`),
  ]);
  const places = new Map<string, PlaceRow | undefined>(
    ids.map((id) => [id, defaultPlace(addresses.filter((x) => str(x.ParentId) === id) as unknown as PlaceRow[], atis.filter((x) => str(x.AccountId) === id).map((x) => str(x.PreferredAddressId)).filter(Boolean))])
  );
  // State licenses belong to the account; DEA and distributor licenses to the address (no AccountId on them).
  const columns = [...new Set(["ComplianceScope", "JurisdictionState", "AccountId", "ContactPointAddressId", "IsLicenseValidated", slnField, deaField, sdlField].filter(Boolean))].join(", ");
  const live = "IsActive = true AND LicenseNumber != null AND PeriodStart <= TODAY AND PeriodEnd >= TODAY ORDER BY PeriodEnd DESC";
  const placeIds = [...places.values()].filter((x): x is PlaceRow => !!x).map((x) => x.Id);
  const placeParts: string[][] = [];
  for (let i = 0; i < placeIds.length; i += 150) placeParts.push(placeIds.slice(i, i + 150));
  const [byAccount, byPlace] = await Promise.all([
    slnOn ? run((inIds) => `SELECT ${columns} FROM BusinessLicense WHERE AccountId IN (${inIds}) AND ${live}`) : Promise.resolve([] as Row[]),
    deaOn || sdlOn
      ? (await Promise.all(placeParts.map((p) => query(`SELECT ${columns} FROM BusinessLicense WHERE ContactPointAddressId IN (${inList(p)}) AND ${live}`, org).catch(() => [] as Row[])))).flat()
      : Promise.resolve([] as Row[]),
  ]);
  for (const a of accounts) {
    const id = str(a.Id);
    const rt = (a.RecordType ?? {}) as Row;
    const person = rt.IsPersonType === true;
    const place = places.get(id);
    const mine = byAccount.filter((l) => str(l.AccountId) === id);
    let badges: VisitCreateAccount["licenses"];
    if (person && place) {
      const state = str(place.StateCode);
      badges = {
        state: licenseBadge(slnOn, state ? mine.find((l) => str(l.ComplianceScope) === "JurisdictionState" && str(l.JurisdictionState) === state) : undefined, slnField),
        dea: licenseBadge(deaOn, byPlace.find((l) => str(l.ComplianceScope) === "Address" && str(l.ContactPointAddressId) === place.Id), deaField),
        sdl: licenseBadge(sdlOn && sdlStates.includes(state), byPlace.find((l) => str(l.ComplianceScope) === "StateDistributorLicense" && str(l.ContactPointAddressId) === place.Id), sdlField),
      };
    }
    result.accounts[id] = {
      person,
      subLabel: (person ? str(titles.find((t) => str(t.AccountId) === id)?.ProfessionalTitle) : str(rt.Name)) || undefined,
      place: place ? { id: place.Id, text: formatAddress(place) } : undefined,
      licenses: badges,
    };
  }
  return result;
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
      custom.map((r) => ({
        masterLabel: r.label,
        entityType: str(r.fields.EntityType),
        actionType: str(r.fields.ActionType),
        actionTarget: str(r.fields.ActionTarget),
        targetType: str(r.fields.TargetType),
        hideBrowser: str(r.fields.HideViewInBrowserAction).toLowerCase() === "true",
      })),
      ctx.core.profile
    ),
    records: recordMenus(ctx.core),
    visitCreate: await collectVisitCreate(ctx).catch(() => undefined),
  };
}
