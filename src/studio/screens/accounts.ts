/** Accounts tab (SearchFilterCustomersViewController) — what the viewer's iPad shows. */

import { count, inList, query, type Row } from "../helpers.js";
import type { ScreenContext } from "./context.js";

export interface PublishedAccountCard {
  id: string;
  name: string;
  /** HCO (non-person record type) draws the building icon, HCP the person icon. */
  hco: boolean;
  /** "--" when the account has no address. */
  address: string;
  /** State license pill; absent when the setting is off or there is no address. */
  license?: "valid" | "invalid";
  /** One entry per column; each is the lines of that cell. */
  cells: string[][];
}

export interface PublishedAccountList {
  id: string;
  name: string;
  /** "N Account(s)". */
  detail: string;
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
  sortLabel: string;
  columns: string[];
  /** The first page (10) of the "All" list. */
  cards: PublishedAccountCard[];
}

/** AccountsListFetcher.pageSize. */
export const PAGE_SIZE = 10;

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

const str = (v: unknown) => (typeof v === "string" ? v : "");
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Rows the viewer can read (the queries run as the admin): UserRecordAccess, 200 ids per query. */
async function readable(ids: string[], ctx: ScreenContext): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks(ids, 200)) {
    const rows = await query(`SELECT RecordId FROM UserRecordAccess WHERE UserId = '${ctx.userId}' AND HasReadAccess = true AND RecordId IN (${inList(part)})`, ctx.org);
    for (const r of rows) out.add(str(r.RecordId));
  }
  return out;
}

/** Members the device holds: a semi-join can't nest the sync filter, so intersect 200 ids at a time. */
async function listCount(listId: string, from: (extra?: string) => string, org: string): Promise<number> {
  const members = await query(`SELECT AccountId FROM LifeSciAccountListMember WHERE LifeScienceAccountListId = '${listId}' AND AccountId != null`, org);
  const ids = [...new Set(members.map((m) => str(m.AccountId)))];
  const parts = await Promise.all(chunks(ids, 200).map((part) => count(`SELECT COUNT() ${from(`Id IN (${inList(part)})`)}`, org)));
  return parts.reduce((a, b) => a + b, 0);
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
    // BaseAccountsFetchQueryCreator: ORDER BY name is null, name ASC.
    query(`SELECT Id, ${nameField}, RecordType.IsPersonType ${from()} ORDER BY ${nameField} ASC NULLS LAST LIMIT ${PAGE_SIZE}`, org),
  ]);

  const ids = accounts.map((a) => str(a.Id));
  const inIds = inList(ids);
  const territoryIds = ctx.territories.map((t) => t.id);
  const slnField = /^\w+$/.test(str(cfg.StateLicenseNumberSettings?.SlnValFormulaField)) ? str(cfg.StateLicenseNumberSettings?.SlnValFormulaField) : "";
  const licensesOn = cfg.StateLicenseNumberSettings?.IsEnabledOnSearchList === true;
  const none = Promise.resolve([] as Row[]);
  const [atis, providers, addresses, licenses] = await Promise.all([
    ids.length && territoryIds.length
      ? query(`SELECT AccountId, IsTargetedAccount, LastProviderVisitDate, PreferredAddressId FROM ProviderAcctTerritoryInfo WHERE AccountId IN (${inIds}) AND Territory2Id IN (${inList(territoryIds)})`, org)
      : none,
    ids.length ? query(`SELECT AccountId, Specialties FROM HealthcareProvider WHERE AccountId IN (${inIds})`, org).catch(() => []) : none,
    ids.length ? query(`SELECT Id, ParentId, Street, PostalCode, City, State, StateCode, Country, IsPrimary FROM ContactPointAddress WHERE ParentId IN (${inIds}) AND IsActive = true`, org).catch(() => []) : none,
    ids.length && licensesOn
      ? query(
          `SELECT AccountId, JurisdictionState, IsLicenseValidated${slnField ? `, ${slnField}` : ""} FROM BusinessLicense WHERE AccountId IN (${inIds}) AND ComplianceScope = 'JurisdictionState' AND IsActive = true AND LicenseNumber != null AND PeriodStart <= TODAY AND PeriodEnd >= TODAY`,
          org
        ).catch(() => [])
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
    let license: PublishedAccountCard["license"];
    if (licensesOn && address !== "--") {
      const l = mine(licenses).find((x) => str(x.JurisdictionState) === str(addr?.StateCode));
      license = l && (slnField ? l[slnField] === true : l.IsLicenseValidated === true) ? "valid" : "invalid";
    }
    return {
      id,
      name: str(a[nameField]),
      hco: (a.RecordType as Row | null)?.IsPersonType === false,
      address,
      license,
      cells: [
        [ati.some((r) => r.IsTargetedAccount === true) ? "Yes" : "No"],
        [last ? formatVisitDate(last, ctx.format) : "--"],
        specialtyLines(mine(providers)[0]?.Specialties),
      ],
    };
  });

  // Sidebar: AccountFiltersService lists of Type 'List', with the members the device holds.
  const listRows = await query("SELECT Id, Name, OwnerId FROM LifeScienceAccountList WHERE Type = 'List'", org).catch(() => []);
  const visible = await readable(listRows.map((l) => str(l.Id)), ctx).catch(() => new Set<string>());
  const counted = await Promise.all(
    listRows
      .filter((l) => visible.has(str(l.Id)))
      .map(async (l) => {
        const n = await listCount(str(l.Id), from, org).catch(() => 0);
        return { id: str(l.Id), name: str(l.Name), ownerId: str(l.OwnerId), detail: `${n} Account${n === 1 ? "" : "s"}` };
      })
  );
  const grouped = groupLists(counted, ctx.userId);
  const strip = ({ id, name, detail }: (typeof counted)[number]): PublishedAccountList => ({ id, name, detail });

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
    sortLabel: sortLabel(["Name"]),
    columns: DEFAULT_COLUMNS,
    cards,
  };
}
