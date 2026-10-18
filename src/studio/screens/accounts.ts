/** Accounts tab (SearchFilterCustomersViewController) — what the viewer's iPad shows. */

import { count, inList, query, queryResult, type Row } from "../helpers.js";
import { isScaleError, softFail, type ScreenContext } from "./context.js";

export interface PublishedAccountCard {
  id: string;
  name: string;
  /** HCO (non-person record type) draws the building icon, HCP the person icon. */
  hco: boolean;
  /** RecordType.DeveloperName, which the card ••• menu filters quick actions by. */
  recordType?: string;
  /** "--" when the account has no address. */
  address: string;
  /** State license pill; absent when the setting is off or there is no address. */
  license?: "valid" | "invalid";
  /** [latitude, longitude] the map view plots (AccountsMapFetchQueryCreator: the preferred address, else the primary one; none when missing or 0). */
  geo?: [number, number];
  /** One entry per column; each is the lines of that cell. */
  /** Values the Sort popover orders by (empty or missing sorts last). */
  sort?: Record<string, string>;
  cells: string[][];
}

export interface PublishedAccountList {
  id: string;
  name: string;
  /** "N Account(s)" ("N+ Accounts" when only some members could be read; "Not counted" when none). */
  detail: string;
  /** Ids of the members the device holds, the first MEMBER_IDS by name; clicking the list narrows the cards to them. Absent when not counted. */
  memberIds?: string[];
}

export interface PublishedAccounts {
  /** Search row buttons: EnableSearchOutsideTerritory, AccountListActions.EnableMultiSelect, EnableMaps. */
  searchOnline: boolean;
  select: boolean;
  maps: boolean;
  newAccount: boolean;
  chips: { label: string; count: string }[];
  /** The viewer's own lists, then "Shared with you". */
  lists: { own: PublishedAccountList[]; shared: PublishedAccountList[] };
  /** The viewer's Advanced Filters (LifeScienceAccountList Type 'AdvancedFilter'): names only, their criteria are evaluated by the app. */
  advancedFilters?: { id: string; name: string }[];
  /** The built-in Filters rows (Next Best Customers, Activity Plans, Activity Plans with Weightages) with the accounts the device would list. */
  builtInFilters?: PublishedAccountList[];
  sortLabel: string;
  columns: string[];
  /** The "All" list in name order, up to CARD_CAP accounts (the device pages 10 at a time as you scroll). */
  cards: PublishedAccountCard[];
}

/** AccountsListFetcher.pageSize. */
export const PAGE_SIZE = 10;

/** The preview holds this many accounts (name order) so chips, sort and lists work client-side; the device pages 10 at a time. */
export const CARD_CAP = 300;

/** Int.toString(withMaxCharactersCount: 4): Int-Double-Float-Extension.swift. */
export function chipCount(n: number): string {
  return n > 9999 ? "999+" : String(n);
}

/** SearchBarViewController: "Sort by: " + names + "  ↑". */
export function sortLabel(names: string[], ascending = true): string {
  return `Sort by: ${names.join(", ")}  ${ascending ? "↑" : "↓"}`;
}

/** AccountFilterConfig default columns (AccountFilterSettings): Target, Last Visit, Specialty. */
export const DEFAULT_COLUMNS = ["Target", "Last Visit", "Specialty"];

/** "Thu, Aug 6, 2026 at 11:19\u202fAM" in the viewer's zone; the device puts U+202F before AM/PM. */
export function formatVisitDate(iso: string, format: { timeZone: string; locale: string }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(format.locale, { timeZone: format.timeZone, ...o }).format(d);
  const date = `${part({ weekday: "short" })}, ${part({ month: "short" })} ${part({ day: "numeric" })}, ${part({ year: "numeric" })}`;
  const time = part({ hour: "numeric", minute: "2-digit" }).replace(/\s(AM|PM)$/i, " $1");
  return `${date} at ${time}`;
}

/** The device joins street, postal code, city, state, country (not the server's FullAddress order). */
export function formatAddress(a: Row): string {
  const parts = ["Street", "PostalCode", "City", "State", "Country"].map((k) => String(a[k] ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : "--";
}

/** Specialty cell: " | " separated; each value cut to 13 chars + "..." at 16; 3+ values show "A," "B," "+N". */
export function specialtyLines(value: unknown): string[] {
  const clip = (s: string) => (s.length > 16 ? `${s.slice(0, 13)}...` : s);
  const items = String(value ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return ["--"];
  if (items.length === 1) return [clip(items[0])];
  if (items.length === 2) return [`${clip(items[0])},`, clip(items[1])];
  return [`${clip(items[0])},`, `${clip(items[1])},`, `+${items.length - 2}`];
}

/** OCEDBAccountFilter: created = owned by the viewer or nobody; shared = owned by someone else. Each sorted case-insensitively. */
export function groupLists<T extends { name: string; ownerId?: string | null }>(lists: T[], userId: string): { own: T[]; shared: T[] } {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const mine = (l: T) => !l.ownerId || l.ownerId.slice(0, 15) === userId.slice(0, 15);
  return { own: lists.filter(mine).sort(byName), shared: lists.filter((l) => !mine(l)).sort(byName) };
}

/** Account rows the device holds: its sync filter, plus an optional extra condition. */
export function accountWhere(scope: string, extra?: string): string {
  const parts = [scope, extra].filter(Boolean);
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

/** The device's map query drops null and 0 coordinates. */
export function plottable(lat: unknown, lon: unknown): boolean {
  return typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Rows the viewer can read (the queries run as the admin): UserRecordAccess, 200 ids per query. */
async function readable(ids: string[], ctx: ScreenContext): Promise<Set<string>> {
  const out = new Set<string>();
  const parts = chunks(ids, 200);
  for (let i = 0; i < parts.length; i += 4) {
    const batch = await Promise.all(
      parts.slice(i, i + 4).map((part) => query(`SELECT RecordId FROM UserRecordAccess WHERE UserId = '${ctx.userId}' AND HasReadAccess = true AND RecordId IN (${inList(part)})`, ctx.org))
    );
    for (const r of batch.flat()) out.add(str(r.RecordId));
  }
  return out;
}

/**
 * Member ids kept per list: the first this many held members by name, enough to narrow the Accounts cards (CARD_CAP)
 * and the Calendar's accounts pane (its first 2,000 by name) exactly. The count covers every member.
 */
export const MEMBER_IDS = 2000;
/** Rows read from the membership table when the org won't take it as a semi-join; past this the count is a lower bound. */
export const CANDIDATE_ROWS = 20_000;
/** Account lists (each way: the viewer's own, others') read for the sidebar. */
export const LIST_ROWS = 2000;
/** Lists whose members are counted; the rest show "Not counted". */
export const LISTS_COUNTED = 100;

export interface HeldMembers {
  ids: string[];
  count: number;
  /** Only some of the membership rows could be read, so `count` is a minimum. */
  atLeast?: boolean;
}

/**
 * The accounts the device holds among those `SELECT AccountId FROM object WHERE where` returns: counted on the
 * server with a semi-join on the Account sync filter, so a list of any size costs two queries. When the org won't
 * take that (a filter that already has semi-joins, an object that can't be a semi-join), the membership rows are
 * read — at most CANDIDATE_ROWS — and intersected with the sync filter 200 ids at a time.
 */
export async function heldMembers(
  ctx: ScreenContext,
  from: (extra?: string) => string,
  object: string,
  where: string,
  what: string
): Promise<HeldMembers> {
  const sub = `SELECT AccountId FROM ${object} WHERE ${where}`;
  if (!/\bSELECT\b/i.test(where)) {
    try {
      const [n, rows] = await Promise.all([
        count(`SELECT COUNT() ${from(`Id IN (${sub})`)}`, ctx.org),
        query(`SELECT Id ${from(`Id IN (${sub})`)} ORDER BY Name ASC NULLS LAST LIMIT ${MEMBER_IDS}`, ctx.org),
      ]);
      return { ids: rows.map((r) => str(r.Id)), count: n };
    } catch (err) {
      // Too slow or too big won't go better row by row; anything else means the org won't take the semi-join.
      if (isScaleError(err)) throw err;
    }
  }
  const res = await queryResult(sub, ctx.org, false, { allowTruncated: true, maxRows: CANDIDATE_ROWS });
  const candidates = [...new Set((res.records as Row[]).map((r) => str(r.AccountId)).filter(Boolean))];
  const held: Row[] = [];
  const parts = chunks(candidates, 200);
  for (let i = 0; i < parts.length; i += 4) {
    held.push(...(await Promise.all(parts.slice(i, i + 4).map((part) => query(`SELECT Id, Name ${from(`Id IN (${inList(part)})`)}`, ctx.org)))).flat());
  }
  if (res.truncated) {
    ctx.note(`${what}: read ${res.records.length.toLocaleString("en-US")} of ${res.totalSize.toLocaleString("en-US")} rows, so its count is a minimum.`);
  }
  const byName = held.sort((a, b) => str(a.Name).localeCompare(str(b.Name), undefined, { sensitivity: "base" }));
  return { ids: byName.slice(0, MEMBER_IDS).map((r) => str(r.Id)), count: held.length, atLeast: res.truncated || undefined };
}

/** "N Account(s)", "N+ Accounts", or "Not counted". */
export function membersDetail(m: HeldMembers | null): string {
  if (!m) return "Not counted";
  if (m.atLeast) return `${m.count.toLocaleString("en-US")}+ Accounts`;
  return `${m.count.toLocaleString("en-US")} Account${m.count === 1 ? "" : "s"}`;
}

/** The active plan cycle of a type for the viewer's territories (OCEDBCallPlanCycleModel / OCEPlanCycle.fetchActive): IsActive and today inside its time period. */
async function activePlanId(type: "AccountGoal" | "WeightedTerritoryGoals", ctx: ScreenContext): Promise<string | undefined> {
  const terr = ctx.territories.map((t) => t.id);
  if (!terr.length) return undefined;
  const plans = await query(
    `SELECT ActivityPlanId, ActivityPlan.TimePeriod.StartDate, ActivityPlan.TimePeriod.EndDate FROM ActivityPlanTerritory WHERE TerritoryId IN (${inList(terr)}) AND ActivityPlan.IsActive = true AND ActivityPlan.Type = '${type}'`,
    ctx.org
  ).catch(softFail(ctx, "Activity Plans filter", [] as Row[]));
  const now = Date.now();
  for (const p of plans) {
    const tp = (p.ActivityPlan as Row | undefined)?.TimePeriod as Row | undefined;
    const start = Date.parse(str(tp?.StartDate));
    const end = Date.parse(str(tp?.EndDate));
    if (start <= now && end >= now) return str(p.ActivityPlanId);
  }
  return undefined;
}

/**
 * BaseAccountsFetchQueryCreator.createCustomListTypeWhere, for the built-in Filters: NBC lists accounts with a TerritoryAccountScore rank; Activity Plans lists
 * accounts with a goal in the active AccountGoal plan cycle that has a measure without products; Weighted lists accounts with a goal in the active
 * WeightedTerritoryGoals cycle. Members are limited to the accounts the device holds.
 */
export async function collectBuiltInFilters(ctx: ScreenContext, from: (extra?: string) => string): Promise<PublishedAccountList[]> {
  const terr = ctx.territories.map((t) => t.id);
  const scoped = (table: string): string | null => {
    const s = ctx.scope(table);
    return s === undefined || s === null ? null : s ? ` AND (${s})` : "";
  };
  const none: HeldMembers = { ids: [], count: 0 };
  const members = (object: string, where: string, what: string): Promise<HeldMembers | null> =>
    heldMembers(ctx, from, object, where, what).catch(softFail(ctx, what, null));
  const nbc = async (): Promise<HeldMembers | null> => {
    const w = scoped("TerritoryAccountScore");
    if (w === null || !terr.length) return none;
    return members("TerritoryAccountScore", `TerritoryId IN (${inList(terr)}) AND Rank != null AND AccountId != null${w}`, "Next Best Customers filter");
  };
  const goals = async (type: "AccountGoal" | "WeightedTerritoryGoals"): Promise<HeldMembers | null> => {
    const w = scoped("ProviderActivityGoal");
    const plan = await activePlanId(type, ctx);
    if (w === null || !plan) return none;
    const measure = type === "AccountGoal" ? " AND Id IN (SELECT ProviderActivityGoalId FROM ProviderActivityGoalMeasure WHERE ProductList = null)" : "";
    const what = type === "AccountGoal" ? "Activity Plans filter" : "Activity Plans with Weightages filter";
    return members("ProviderActivityGoal", `ActivityPlanId = '${plan}' AND AccountId != null${measure}${w}`, what);
  };
  const [n, a, wt] = await Promise.all([nbc(), goals("AccountGoal"), goals("WeightedTerritoryGoals")]);
  const row = (id: string, name: string, m: HeldMembers | null): PublishedAccountList => ({ id, name, detail: membersDetail(m), ...(m ? { memberIds: m.ids } : {}) });
  return [row("filter:nbc", "Next Best Customers", n), row("filter:activityplan", "Activity Plans", a), row("filter:weighted", "Activity Plans with Weightages", wt)];
}

async function byIds(ids: string[], run: (inIds: string) => Promise<Row[]>): Promise<Row[]> {
  return (await Promise.all(chunks(ids, 150).map((part) => run(inList(part))))).flat();
}

/**
 * The sidebar's lists: the viewer's own, plus the org's other lists the viewer can read (UserRecordAccess) — at most
 * LIST_ROWS of each, most recently changed first. Members are counted for the first LISTS_COUNTED (own first, by name).
 */
async function sidebarLists(ctx: ScreenContext, from: (extra?: string) => string) {
  const { org, userId } = ctx;
  const read = (where: string, order: string) =>
    queryResult(`SELECT Id, Name, OwnerId FROM LifeScienceAccountList WHERE Type = 'List' AND ${where} ORDER BY ${order}`, org, false, { allowTruncated: true, maxRows: LIST_ROWS }).catch(
      softFail(ctx, "Account lists", null)
    );
  const [own, others] = await Promise.all([read(`OwnerId = '${userId}'`, "Name"), read(`OwnerId != '${userId}'`, "LastModifiedDate DESC")]);
  if (own?.truncated) ctx.note(`Account lists: showing ${own.records.length.toLocaleString("en-US")} of the viewer's ${own.totalSize.toLocaleString("en-US")} lists.`);
  if (others?.truncated) ctx.note(`Account lists: checked the ${others.records.length.toLocaleString("en-US")} most recently changed of ${others.totalSize.toLocaleString("en-US")} other lists in the org for sharing.`);
  const otherRows = (others?.records ?? []) as Row[];
  const visible = await readable(otherRows.map((l) => str(l.Id)), ctx).catch(softFail(ctx, "Account lists shared with the viewer", new Set<string>()));
  const rows = [...((own?.records ?? []) as Row[]), ...otherRows.filter((l) => visible.has(str(l.Id)))];
  if (rows.length > LISTS_COUNTED) ctx.note(`Account lists: members counted for the first ${LISTS_COUNTED} of ${rows.length.toLocaleString("en-US")} lists; the rest show "Not counted".`);
  const out: { id: string; name: string; ownerId: string; detail: string; memberIds?: string[] }[] = [];
  const counting = rows.slice(0, LISTS_COUNTED);
  for (let i = 0; i < counting.length; i += 4) {
    out.push(
      ...(await Promise.all(
        counting.slice(i, i + 4).map(async (l) => {
          const m = await heldMembers(ctx, from, "LifeSciAccountListMember", `LifeScienceAccountListId = '${str(l.Id)}' AND AccountId != null`, `Account list "${str(l.Name)}"`).catch(
            softFail(ctx, `Account list "${str(l.Name)}"`, null)
          );
          return { id: str(l.Id), name: str(l.Name), ownerId: str(l.OwnerId), detail: membersDetail(m), ...(m ? { memberIds: m.ids } : {}) };
        })
      ))
    );
  }
  for (const l of rows.slice(LISTS_COUNTED)) out.push({ id: str(l.Id), name: str(l.Name), ownerId: str(l.OwnerId), detail: membersDetail(null) });
  return out;
}

export async function collectAccounts(ctx: ScreenContext): Promise<PublishedAccounts | undefined> {
  const scope = ctx.scope("Account");
  if (scope === undefined || scope === null) return undefined;
  const { org } = ctx;
  const cfg = await ctx.config(["StateLicenseNumberSettings", "AccountSearchSettings", "AccountListActions", "AccountSearchPreferences"]).catch(() => ({}) as Record<string, Row>);
  const flag = (category: string, key: string) => (cfg[category]?.[key] === false ? false : true);
  const nameField = /^\w+$/.test(str(cfg.AccountSearchSettings?.AccountNameField)) ? str(cfg.AccountSearchSettings?.AccountNameField) : "Name";

  const from = (extra?: string) => `FROM Account${accountWhere(scope, extra)}`;
  const [total, hco, hcp, accounts] = await Promise.all([
    count(`SELECT COUNT() ${from()}`, org),
    count(`SELECT COUNT() ${from("RecordType.IsPersonType = false")}`, org),
    count(`SELECT COUNT() ${from("RecordType.IsPersonType = true")}`, org),
    // BaseAccountsFetchQueryCreator: ORDER BY name is null, name ASC. First/Last Name exist only with person accounts.
    query(`SELECT Id, ${nameField}, FirstName, LastName, RecordType.IsPersonType, RecordType.DeveloperName ${from()} ORDER BY ${nameField} ASC NULLS LAST LIMIT ${CARD_CAP}`, org).catch(() =>
      query(`SELECT Id, ${nameField}, RecordType.IsPersonType, RecordType.DeveloperName ${from()} ORDER BY ${nameField} ASC NULLS LAST LIMIT ${CARD_CAP}`, org)
    ),
  ]);

  const ids = accounts.map((a) => str(a.Id));
  const territoryIds = ctx.territories.map((t) => t.id);
  const slnField = /^\w+$/.test(str(cfg.StateLicenseNumberSettings?.SlnValFormulaField)) ? str(cfg.StateLicenseNumberSettings?.SlnValFormulaField) : "";
  const licensesOn = cfg.StateLicenseNumberSettings?.IsEnabledOnSearchList === true;
  const none = Promise.resolve([] as Row[]);
  const [atis, providers, addresses, licenses] = await Promise.all([
    ids.length && territoryIds.length
      ? byIds(ids, (inIds) => {
          const where = `FROM ProviderAcctTerritoryInfo WHERE AccountId IN (${inIds}) AND Territory2Id IN (${inList(territoryIds)})`;
          // NextProviderVisitDate feeds the Next Visit Date sort; fall back if the org has no such column.
          return query(`SELECT AccountId, IsTargetedAccount, LastProviderVisitDate, NextProviderVisitDate, PreferredAddressId ${where}`, org).catch(() =>
            query(`SELECT AccountId, IsTargetedAccount, LastProviderVisitDate, PreferredAddressId ${where}`, org)
          );
        })
      : none,
    ids.length ? byIds(ids, (inIds) => query(`SELECT AccountId, Specialties FROM HealthcareProvider WHERE AccountId IN (${inIds})`, org).catch(softFail(ctx, "Accounts", [] as Row[]))) : none,
    ids.length ? byIds(ids, (inIds) => query(`SELECT Id, ParentId, Street, PostalCode, City, State, StateCode, Country, IsPrimary, Latitude, Longitude FROM ContactPointAddress WHERE ParentId IN (${inIds}) AND IsActive = true`, org).catch(softFail(ctx, "Accounts", [] as Row[]))) : none,
    ids.length && licensesOn
      ? byIds(ids, (inIds) =>
          query(
            `SELECT AccountId, JurisdictionState, IsLicenseValidated${slnField ? `, ${slnField}` : ""} FROM BusinessLicense WHERE AccountId IN (${inIds}) AND ComplianceScope = 'JurisdictionState' AND IsActive = true AND LicenseNumber != null AND PeriodStart <= TODAY AND PeriodEnd >= TODAY`,
            org
          ).catch(softFail(ctx, "Accounts", [] as Row[]))
        )
      : none,
  ]);

  const cards: PublishedAccountCard[] = accounts.map((a) => {
    const id = str(a.Id);
    const mine = <T extends Row>(rows: T[], key = "AccountId") => rows.filter((r) => str(r[key]) === id);
    const ati = mine(atis);
    const last = ati.map((r) => str(r.LastProviderVisitDate)).filter(Boolean).sort().pop();
    const addrs = mine(addresses, "ParentId");
    const preferred = ati.map((r) => str(r.PreferredAddressId)).filter(Boolean);
    const addr = addrs.find((x) => preferred.includes(str(x.Id))) ?? addrs.find((x) => x.IsPrimary === true) ?? addrs[0];
    const address = addr ? formatAddress(addr) : "--";
    const mapAddr = preferred.length ? addrs.find((x) => str(x.Id) === preferred[0]) : addrs.find((x) => x.IsPrimary === true);
    const geo = mapAddr && plottable(mapAddr.Latitude, mapAddr.Longitude) ? ([mapAddr.Latitude, mapAddr.Longitude] as [number, number]) : undefined;
    let license: PublishedAccountCard["license"];
    if (licensesOn && address !== "--") {
      const l = mine(licenses).find((x) => str(x.JurisdictionState) === str(addr?.StateCode));
      license = l && (slnField ? l[slnField] === true : l.IsLicenseValidated === true) ? "valid" : "invalid";
    }
    const next = ati.map((r) => str(r.NextProviderVisitDate)).filter(Boolean).sort()[0];
    const specialty = str(mine(providers)[0]?.Specialties);
    return {
      id,
      name: str(a[nameField]),
      hco: (a.RecordType as Row | null)?.IsPersonType === false,
      recordType: str((a.RecordType as Row | null)?.DeveloperName) || undefined,
      address,
      license,
      geo,
      sort: {
        name: str(a[nameField]),
        firstName: str(a.FirstName),
        lastName: str(a.LastName),
        addressLine1: str(addr?.Street),
        city: str(addr?.City),
        state: str(addr?.State),
        zip: str(addr?.PostalCode),
        lastVisit: last ?? "",
        nextVisit: next ?? "",
        specialty,
      },
      cells: [
        [ati.some((r) => r.IsTargetedAccount === true) ? "Yes" : "No"],
        [last ? formatVisitDate(last, ctx.format) : "--"],
        specialtyLines(mine(providers)[0]?.Specialties),
      ],
    };
  });

  // Sidebar: AccountFiltersService lists of Type 'List' the viewer can read, with the members the device holds.
  const counted = await sidebarLists(ctx, from);
  const advancedResult = await queryResult("SELECT Id, Name FROM LifeScienceAccountList WHERE Type = 'AdvancedFilter' ORDER BY Name", org, false, { allowTruncated: true, maxRows: LIST_ROWS }).catch(
    softFail(ctx, "Advanced Filters", null)
  );
  if (advancedResult?.truncated) ctx.note(`Advanced Filters: showing the first ${advancedResult.records.length.toLocaleString("en-US")} of ${advancedResult.totalSize.toLocaleString("en-US")} by name.`);
  const advanced = (advancedResult?.records ?? []) as Row[];
  const grouped = groupLists(counted, ctx.userId);
  const strip = ({ id, name, detail, memberIds }: (typeof counted)[number]): PublishedAccountList => ({ id, name, detail, memberIds });

  return {
    searchOnline: flag("AccountSearchPreferences", "EnableSearchOutsideTerritory"),
    select: flag("AccountListActions", "EnableMultiSelect"),
    maps: flag("AccountSearchPreferences", "EnableMaps"),
    newAccount: true,
    chips: [
      { label: "All", count: chipCount(total) },
      { label: "HCO", count: chipCount(hco) },
      { label: "HCP", count: chipCount(hcp) },
    ],
    lists: { own: grouped.own.map(strip), shared: grouped.shared.map(strip) },
    advancedFilters: advanced.map((a) => ({ id: str(a.Id), name: str(a.Name) })),
    builtInFilters: await collectBuiltInFilters(ctx, from).catch(softFail(ctx, "Filters", undefined)),
    sortLabel: sortLabel(["Name"]),
    columns: DEFAULT_COLUMNS,
    cards,
  };
}
