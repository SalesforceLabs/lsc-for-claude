/**
 * The Account Dashboard tab's cards, read live like the app reads them from its local tables:
 * Provider Summary (SmartSummaryViewModel), Overview (AccountOverviewCardViewModel), Next Best
 * Actions (NBSRepository) and Map (AccountMapViewModel). Read-only SOQL.
 */

import { ID_PATTERN, inList, query, type Row } from "../helpers.js";
import type { ScreenContext } from "./context.js";
import { apiRequest, dataPath } from "../../salesforce/cli.js";
import { formatAddress, plottable } from "./accounts.js";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export interface PublishedDashboard {
  summary: { generated: string; sections: { title: string; items: string[] }[] } | null;
  overview: { target: boolean; specialties: { label: string; primary: boolean }[] };
  nba: { week: string; items: { id: string; title: string; type: string; due: string; status: string }[] };
  map: { address: string; license: "validated" | "notValidated" | "disabled"; /** Latitude, longitude of the address the map centres on (null/0 coordinates dropped like the device). */ geo?: [number, number] };
}

interface SummarySection {
  title: string;
  content: string[];
}

/** SmartSummaryData: `keyInfo` / `changeInfo` arrays of `{ sectionName, sectionData: [{ data }] }`. */
export function decodeSummary(json: string): { keyInfo: SummarySection[]; changeInfo: SummarySection[] } {
  const empty = { keyInfo: [], changeInfo: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }
  const sections = (v: unknown): SummarySection[] =>
    (Array.isArray(v) ? v : []).map((s: Row) => ({
      title: str(s?.sectionName),
      content: (Array.isArray(s?.sectionData) ? (s.sectionData as Row[]) : []).map((d) => str(d?.data)),
    }));
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Row;
  return { keyInfo: sections(o.keyInfo), changeInfo: sections(o.changeInfo) };
}

/**
 * SmartSummaryViewModel.getSummaryContent: every "change info" section is folded into one
 * "Changes" section (the key-info JSON's first, then the change-info JSON's), then the key-info sections.
 */
export function summaryContent(keyInfoJson: string, changeInfoJson: string): SummarySection[] {
  const key = decodeSummary(keyInfoJson);
  const change = decodeSummary(changeInfoJson);
  const changes = [...key.changeInfo, ...change.changeInfo].flatMap((s) => s.content);
  return [...(changes.length ? [{ title: "Changes", content: changes }] : []), ...key.keyInfo];
}

/** The week the card shows: Monday to Sunday around `now` in the viewer's time zone, as "Oct 12 – 18". */
export function weekRange(now: Date, format: { timeZone: string; locale: string }): { from: string; to: string; label: string } {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: format.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [y, m, d] = day(now).split("-").map(Number);
  const local = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(local.getTime() - sinceMonday * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const locale = (() => {
    try {
      return Intl.getCanonicalLocales(format.locale)[0] ?? "en-US";
    } catch {
      return "en-US";
    }
  })();
  const month = (x: Date) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(x);
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth();
  const end = sameMonth ? String(sunday.getUTCDate()) : month(sunday);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10), label: `${month(monday)} – ${end}` };
}

function generatedText(first: string, second: string, format: { timeZone: string; locale: string }): string {
  const dates = [first, second].map((x) => new Date(x)).filter((d) => !Number.isNaN(d.getTime()));
  if (!dates.length) return "";
  const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
  // Date.sfString(dateStyle: .full, timeStyle: .short): "Saturday, October 17, 2026 at 4:14 PM".
  return `Summary generated on ${new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: format.timeZone }).format(latest)}`;
}

const none = [] as Row[];

export async function collectDashboards(ctx: ScreenContext, ids: string[]): Promise<Map<string, PublishedDashboard>> {
  const out = new Map<string, PublishedDashboard>();
  const accounts = ids.filter((id) => ID_PATTERN.test(id));
  if (!accounts.length) return out;
  const inIds = inList(accounts);
  const territoryIds = ctx.territories.map((t) => t.id);
  const week = weekRange(new Date(), ctx.format);
  const cfg = await ctx.config(["StateLicenseNumberSettings"]).catch(() => ({}) as Record<string, Row>);
  const licensesOn = cfg.StateLicenseNumberSettings?.IsEnabledOnLightningPages === true;
  const slnField = /^\w+$/.test(str(cfg.StateLicenseNumberSettings?.SlnValFormulaField)) ? str(cfg.StateLicenseNumberSettings?.SlnValFormulaField) : "";
  const synced = (table: string) => ctx.scope(table) !== undefined;
  const run = (table: string, soql: string) => (synced(table) ? query(soql, ctx.org).catch(() => none) : Promise.resolve(none));

  const [summaries, specialties, atis, addresses, nba, licenses] = await Promise.all([
    territoryIds.length
      ? run(
          "PrvdAccountTerritorySummary",
          `SELECT AccountId, Territory2Id, KeyInformationSummary, ChangeInformationSummary, KeyInfoSummaryDateTime, ChangeInfoSummaryDateTime FROM PrvdAccountTerritorySummary WHERE AccountId IN (${inIds}) AND UserId = '${ctx.userId}' AND Territory2Id IN (${inList(territoryIds)})`
        )
      : Promise.resolve(none),
    run(
      "HealthcareProviderSpecialty",
      `SELECT AccountId, IsPrimarySpecialty, Specialty.SpecialtyType FROM HealthcareProviderSpecialty WHERE AccountId IN (${inIds}) ORDER BY IsPrimarySpecialty DESC, LastModifiedDate DESC`
    ),
    territoryIds.length
      ? run("ProviderAcctTerritoryInfo", `SELECT AccountId, IsTargetedAccount, PreferredAddressId FROM ProviderAcctTerritoryInfo WHERE AccountId IN (${inIds}) AND Territory2Id IN (${inList(territoryIds)})`)
      : Promise.resolve(none),
    run("ContactPointAddress", `SELECT Id, ParentId, Street, PostalCode, City, State, StateCode, Country, IsPrimary, Latitude, Longitude, LastModifiedDate FROM ContactPointAddress WHERE ParentId IN (${inIds}) AND IsActive = true`),
    run(
      "TerritoryAcctRcmdAction",
      `SELECT Id, AccountId, Name, ActionType, Status, DueDate FROM TerritoryAcctRcmdAction WHERE AccountId IN (${inIds}) AND DueDate >= ${week.from} AND DueDate <= ${week.to} ORDER BY DueDate ASC`
    ),
    licensesOn
      ? run(
          "BusinessLicense",
          `SELECT AccountId, JurisdictionState, IsLicenseValidated${slnField ? `, ${slnField}` : ""} FROM BusinessLicense WHERE AccountId IN (${inIds}) AND ComplianceScope = 'JurisdictionState' AND IsActive = true AND LicenseNumber != null`
        )
      : Promise.resolve(none),
  ]);

  // Specialty types print with their picklist labels.
  const typeLabels = new Map<string, string>();
  try {
    const d = await apiRequest<Row>(await dataPath(ctx.org, "/sobjects/CareSpecialty/describe"), "GET", undefined, ctx.org);
    const f = (Array.isArray(d.data?.fields) ? (d.data?.fields as Row[]) : []).find((x) => str(x.name) === "SpecialtyType");
    for (const p of Array.isArray(f?.picklistValues) ? (f?.picklistValues as Row[]) : []) typeLabels.set(str(p.value), str(p.label) || str(p.value));
  } catch {
    // labels stay as values
  }

  const territoryRank = new Map(territoryIds.map((t, i) => [t, i]));
  for (const id of accounts) {
    const mine = (rows: Row[], key = "AccountId") => rows.filter((r) => str(r[key]) === id);
    // SmartSummaryView fetches for the selected territory; the first of the viewer's territories that has a row.
    const row = mine(summaries).sort((a, b) => (territoryRank.get(str(a.Territory2Id)) ?? 99) - (territoryRank.get(str(b.Territory2Id)) ?? 99))[0];
    const content = row ? summaryContent(str(row.KeyInformationSummary), str(row.ChangeInformationSummary)) : [];
    const ati = mine(atis);
    const addrs = mine(addresses, "ParentId");
    const preferred = ati.map((r) => str(r.PreferredAddressId)).filter(Boolean);
    const newest = (rows: Row[]) => [...rows].sort((a, b) => str(b.LastModifiedDate).localeCompare(str(a.LastModifiedDate)));
    const addr = addrs.find((x) => preferred.includes(str(x.Id))) ?? newest(addrs).find((x) => x.IsPrimary === true) ?? newest(addrs)[0];
    let license: PublishedDashboard["map"]["license"] = "disabled";
    if (licensesOn && addr) {
      const l = mine(licenses).find((x) => str(x.JurisdictionState) === str(addr.StateCode));
      license = l && (slnField ? l[slnField] === true : l.IsLicenseValidated === true) ? "validated" : "notValidated";
    }
    out.set(id, {
      summary: content.length ? { generated: generatedText(str(row?.KeyInfoSummaryDateTime), str(row?.ChangeInfoSummaryDateTime), ctx.format), sections: content.map((s) => ({ title: s.title, items: s.content })) } : null,
      overview: {
        target: ati.some((r) => r.IsTargetedAccount === true),
        specialties: mine(specialties)
          .slice(0, 3)
          .map((s) => {
            const type = str((s.Specialty as Row | null)?.SpecialtyType);
            return { label: typeLabels.get(type) ?? type, primary: s.IsPrimarySpecialty === true };
          })
          .filter((s) => s.label),
      },
      nba: {
        week: week.label,
        items: mine(nba).map((r) => ({ id: str(r.Id), title: str(r.Name), type: str(r.ActionType), due: str(r.DueDate), status: str(r.Status) })),
      },
      map: { address: addr ? formatAddress(addr) : "", license, ...(addr && plottable(addr.Latitude, addr.Longitude) ? { geo: [addr.Latitude as number, addr.Longitude as number] as [number, number] } : {}) },
    });
  }
  return out;
}
