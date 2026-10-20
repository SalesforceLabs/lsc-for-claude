/**
 * Territory & Users — the territory model, how accounts are aligned to it,
 * which field users sit in it, and whether they're licensed.
 */

import type { CustomCollector } from "../collect.js";
import type { StudioFinding, StudioItem } from "../types.js";
import { sharedRead } from "../../config/read-cache.js";
import { chunkIds } from "../../tools/helpers.js";
import {
  approxCount,
  buildSurface,
  configItem,
  count,
  countGroupedBy,
  inList,
  item,
  profileAudience,
  query,
  queryResult,
  recordCounts,
  scalar,
  settle,
  showingNote,
  unwrap,
  type Row,
} from "../helpers.js";
import { fetchCategories, profilesOf } from "./shared.js";

const LSC_PSL_FILTER = `DeveloperName LIKE '%LSC4CE%' OR DeveloperName LIKE '%LifeScience%' OR DeveloperName LIKE '%HealthCloud%' OR DeveloperName LIKE '%IndustrySales%' OR DeveloperName LIKE '%CLM%' OR DeveloperName LIKE '%SampleManagement%'`;
const LSC_PS_FILTER = `(NamespacePrefix IN ('lsc4ce', 'HealthCloudGA') OR Label LIKE '%Life Science%' OR Label LIKE '%Sample%' OR Label LIKE '%CLM%') AND IsOwnedByProfile = false`;
const USER_LIMIT = 500;
const RULE_LIMIT = 500;
/** Territories and explicit-assignment rows sent to the app; counts and findings always cover all of them. */
const TERRITORY_DISPLAY_LIMIT = 500;
/**
 * Above this many ObjectTerritory2Association rows (from storage statistics) accounts aren't counted
 * per territory: the grouped count reads every row and runs past the timeout in big orgs.
 */
const OT2A_COUNT_LIMIT = 1_000_000;
/** Rows read when there is no active model to scope the territory list. */
const UNSCOPED_TERRITORY_LIMIT = 2000;
/** The Life Sciences Commercial PSL every LSC user needs. */
export const LSC_PSL = /LSC4CE|LifeScienceCommercial/i;

/** Some alignment objects only exist when the matching LSC feature is enabled. */
async function optionalQuery(soql: string, org: string): Promise<Row[] | null> {
  try {
    return await query(soql, org);
  } catch (err) {
    if (/is not supported|INVALID_TYPE/i.test(String(err instanceof Error ? err.message : err))) return null;
    throw err;
  }
}

const NOT_AVAILABLE: StudioFinding = {
  severity: "info",
  title: "Not available in this org",
  detail: "The object doesn't exist here — the feature isn't enabled or licensed.",
};

function rel(r: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], r);
}

class TooManyAssignments extends Error {
  constructor(readonly rows: number) {
    super(`About ${rows.toLocaleString("en-US")} territory assignments — too many to count by territory here.`);
  }
}

/** Why accounts per territory weren't counted, as an info finding. */
function uncountedAccounts(err: unknown): StudioFinding {
  return err instanceof TooManyAssignments
    ? { severity: "info", title: "Accounts not counted per territory", detail: `${err.message} Users per territory are still shown.` }
    : { severity: "info", title: "Couldn't count accounts per territory", detail: err instanceof Error ? err.message : String(err) };
}

/** COUNT(Id) grouped by `key` → Map. */
async function countBy(soql: string, key: string, org: string): Promise<Map<string, number>> {
  const rows = await query(soql, org);
  return new Map(rows.map((r) => [String(r[key]), Number(r.cnt ?? r.expr0 ?? 0)]));
}

/**
 * Territories of the active model (all models when none is active, capped).
 * Shared for a minute: the map, readiness checks and counts all start here.
 */
export function activeTerritories(org: string): Promise<{ rows: Row[]; model: Row | undefined; capped: boolean }> {
  return sharedRead(org, "studio:territories", async () => {
    const models = await query(`SELECT Id, Name, DeveloperName, State, ActivatedDate FROM Territory2Model ORDER BY Name`, org);
    const model = models.find((m) => m.State === "Active");
    const fields = `Id, Name, DeveloperName, Territory2ModelId, Territory2Model.State, Territory2Type.MasterLabel, ParentTerritory2Id, ParentTerritory2.Name`;
    if (model) {
      const rows = await query(`SELECT ${fields} FROM Territory2 WHERE Territory2ModelId = '${model.Id}' ORDER BY Name`, org);
      return { rows, model, capped: false };
    }
    const r = await queryResult(`SELECT ${fields} FROM Territory2 ORDER BY Name LIMIT ${UNSCOPED_TERRITORY_LIMIT}`, org, false, { allowTruncated: true });
    return { rows: r.records as Row[], model, capped: r.records.length === UNSCOPED_TERRITORY_LIMIT };
  });
}

/** Field profiles — those with LSC Mobile app settings; falls back to a name heuristic. */
export async function fieldProfiles(org: string): Promise<string[]> {
  try {
    const recs = await fetchCategories(org, ["ProfileBasedAppSettings"]);
    const names = [...new Set(recs.flatMap(profilesOf))];
    if (names.length) return names;
  } catch {
    // fall through to the heuristic
  }
  const rows = await query(
    `SELECT Name FROM Profile WHERE Name LIKE '%Life Science%' OR Name LIKE 'LS %' OR Name LIKE '%LSC%'`,
    org
  );
  return rows.map((r) => String(r.Name));
}

export const collectTerritoryUsers: CustomCollector = async (org) => {
  const models = settle(query(`SELECT Id, Name, DeveloperName, State, ActivatedDate FROM Territory2Model ORDER BY Name`, org));
  const territories = settle(activeTerritories(org));
  const territoryIds = async () => (await unwrap(territories)).rows.map((t) => String(t.Id));
  const usersPerTerritory = settle(
    territoryIds().then((ids) => countGroupedBy("UserTerritory2Association", "Territory2Id", ids, org))
  );
  const ot2aRows = recordCounts(["ObjectTerritory2Association"], org).then((m) => m.get("objectterritory2association"));
  const accountsPerTerritory = settle(
    Promise.all([territoryIds(), ot2aRows]).then(([ids, rows]) => {
      if (rows && rows > OT2A_COUNT_LIMIT) throw new TooManyAssignments(rows);
      return countGroupedBy("ObjectTerritory2Association", "Territory2Id", ids, org, "SobjectType = 'Account'");
    })
  );
  const profiles = settle(fieldProfiles(org));
  const fieldUsers = settle(
    unwrap(profiles).then(async (names) => {
      if (names.length === 0) return { total: 0, users: [] as Row[], territoriesByUser: new Map<string, string[]>() };
      const where = `IsActive = true AND Profile.Name IN (${inList(names)})`;
      const [total, users] = await Promise.all([
        count(`SELECT COUNT() FROM User WHERE ${where}`, org),
        query(
          `SELECT Id, Name, Username, Profile.Name, UserRole.Name, (SELECT PermissionSetLicense.MasterLabel, PermissionSetLicense.DeveloperName FROM PermissionSetLicenseAssignments) FROM User WHERE ${where} ORDER BY Name LIMIT ${USER_LIMIT}`,
          org
        ),
      ]);
      // Territories are read from the association directly: a nested subquery stops at 200 per user.
      const territoriesByUser = new Map<string, string[]>();
      const assoc = await Promise.all(
        chunkIds(users.map((u) => String(u.Id))).map((ids) =>
          query(`SELECT UserId, Territory2.Name FROM UserTerritory2Association WHERE UserId IN (${inList(ids)})`, org)
        )
      );
      for (const a of assoc.flat()) {
        const list = territoriesByUser.get(String(a.UserId)) ?? [];
        list.push(String(rel(a, "Territory2.Name")));
        territoriesByUser.set(String(a.UserId), list);
      }
      return { total, users, territoriesByUser };
    })
  );

  const psls = settle(
    query(
      `SELECT Id, DeveloperName, MasterLabel, TotalLicenses, UsedLicenses, Status FROM PermissionSetLicense WHERE ${LSC_PSL_FILTER} ORDER BY MasterLabel`,
      org
    )
  );

  let territoryTotal = 0;
  let fieldUserTotal = 0;

  const surfaces = await Promise.all([
    buildSurface(
      { id: "territoryModels", title: "Territory Models", lane: "model", description: "Enterprise Territory Management models. Only one can be active." },
      async () => {
        const rows = await unwrap(models);
        const findings: StudioFinding[] = [];
        if (!rows.some((m) => m.State === "Active")) {
          findings.push({
            severity: "error",
            title: "No active territory model",
            detail: "LSC account access, alignment jobs, and Provider Account Territory Info all depend on an active model.",
          });
        }
        return {
          items: rows.map((m) =>
            item(String(m.Id), String(m.Name), {
              sublabel: String(m.State),
              active: m.State === "Active",
              properties: { "Developer name": scalar(m.DeveloperName), State: scalar(m.State), Activated: scalar(m.ActivatedDate) },
            })
          ),
          findings,
        };
      }
    ),
    buildSurface(
      { id: "territories", title: "Territories", lane: "model", description: "Territories in the active model, with assigned users and accounts." },
      async () => {
        const [{ rows: inModel, capped }, users, accountsResult] = await Promise.all([
          unwrap(territories),
          unwrap(usersPerTerritory),
          accountsPerTerritory,
        ]);
        // Users per territory are worth showing even when accounts couldn't be counted.
        const accounts = accountsResult.ok ? accountsResult.value : undefined;
        const parents = new Set(inModel.map((t) => t.ParentTerritory2Id).filter(Boolean));
        let emptyLeaves = 0;
        const all = inModel.map((t) => {
          const id = String(t.Id);
          const u = users.get(id) ?? 0;
          const a = accounts?.get(id) ?? 0;
          if (u === 0 && !parents.has(t.Id)) emptyLeaves++;
          return { t, id, u, a };
        });
        // Thousands of territories are too many to send to the app: the busiest come first.
        const shown = all.length > TERRITORY_DISPLAY_LIMIT ? [...all].sort((x, y) => y.u + y.a - (x.u + x.a)).slice(0, TERRITORY_DISPLAY_LIMIT) : all;
        const items: StudioItem[] = shown.map(({ t, id, u, a }) =>
          item(id, String(t.Name), {
            sublabel: [rel(t, "Territory2Type.MasterLabel"), rel(t, "ParentTerritory2.Name") && `in ${rel(t, "ParentTerritory2.Name")}`]
              .filter(Boolean)
              .join(" · "),
            properties: {
              "Developer name": scalar(t.DeveloperName),
              Type: scalar(rel(t, "Territory2Type.MasterLabel")),
              Parent: scalar(rel(t, "ParentTerritory2.Name")),
              Users: u,
              ...(accounts ? { "Explicit accounts": a } : {}),
            },
          })
        );
        territoryTotal = all.length;
        const findings: StudioFinding[] = accountsResult.ok ? [] : [uncountedAccounts(accountsResult.error)];
        if (emptyLeaves) {
          findings.push({ severity: "info", title: `${emptyLeaves} leaf territories have no users`, detail: "Accounts aligned to them aren't covered by a rep — check for vacancies or leftover territories." });
        }
        if (shown.length < all.length) findings.push(showingNote(shown.length, all.length, "territories", accounts ? "Those with the most users and accounts first" : "Those with the most users first"));
        if (capped) findings.push({ severity: "info", title: `Showing the first ${UNSCOPED_TERRITORY_LIMIT.toLocaleString("en-US")} territories`, detail: "No territory model is active, so territories from every model are listed." });
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "explicitAssignments", title: "Explicit Assignments", lane: "alignment", description: "ObjectTerritory2Association — accounts assigned to territories, by territory." },
      async () => {
        const [{ rows }, accountsResult] = await Promise.all([unwrap(territories), accountsPerTerritory]);
        if (!accountsResult.ok) return { items: [], findings: [uncountedAccounts(accountsResult.error)] };
        const accounts = accountsResult.value;
        const names = new Map(rows.map((t) => [String(t.Id), String(t.Name)]));
        const sorted = [...accounts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        const items = sorted
          .slice(0, TERRITORY_DISPLAY_LIMIT)
          .map(([id, n]) =>
            item(`ota:${id}`, names.get(id) ?? id, { sublabel: `${n} accounts`, properties: { Territory: names.get(id) ?? id, Accounts: n } })
          );
        const findings = sorted.length > items.length ? [showingNote(items.length, sorted.length, "territories with assigned accounts", "Most accounts first")] : [];
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "geoRules", title: "Geo Rules", lane: "alignment", description: "TerrGeoAssignmentRule — postal-code / geography based alignment." },
      async () => {
        const rows = await optionalQuery(
          `SELECT Id, Name, Territory2Id, Territory2.Name, UsageType, GeoCodeType, GeoCode, EffectiveStartDate, EffectiveEndDate FROM TerrGeoAssignmentRule ORDER BY UsageType, Territory2.Name LIMIT 500`,
          org
        );
        if (!rows) return { items: [], findings: [NOT_AVAILABLE] };
        const total = rows.length === RULE_LIMIT ? await count(`SELECT COUNT() FROM TerrGeoAssignmentRule`, org) : rows.length;
        const today = new Date().toISOString().slice(0, 10);
        return {
          findings: total > rows.length ? [showingNote(rows.length, total, "geo rules")] : [],
          items: rows.map((r) =>
            item(String(r.Id), String(r.Name), {
              sublabel: [rel(r, "Territory2.Name"), r.GeoCode, r.UsageType].filter(Boolean).join(" · "),
              // Geo rules have no active flag; a rule applies between its effective dates.
              active: (!r.EffectiveStartDate || String(r.EffectiveStartDate) <= today) && (!r.EffectiveEndDate || String(r.EffectiveEndDate) >= today),
              properties: {
                Territory: scalar(rel(r, "Territory2.Name")),
                "Geo code": scalar(r.GeoCode),
                "Code type": scalar(r.GeoCodeType),
                Usage: scalar(r.UsageType),
                From: scalar(r.EffectiveStartDate),
                To: scalar(r.EffectiveEndDate),
              },
            })
          ),
        };
      }
    ),
    buildSurface(
      { id: "affiliationRules", title: "Affiliation Rules", lane: "alignment", description: "TerrProvAffilAssignRule — align providers through their affiliations." },
      async () => {
        const rows = await optionalQuery(
          `SELECT Id, Name, Territory2Id, Territory2.Name, AccountType, AffiliationRole FROM TerrProvAffilAssignRule ORDER BY Territory2.Name LIMIT 500`,
          org
        );
        if (!rows) return { items: [], findings: [NOT_AVAILABLE] };
        const total = rows.length === RULE_LIMIT ? await count(`SELECT COUNT() FROM TerrProvAffilAssignRule`, org) : rows.length;
        return {
          findings: total > rows.length ? [showingNote(rows.length, total, "affiliation rules")] : [],
          items: rows.map((r) =>
            item(String(r.Id), String(r.Name), {
              sublabel: [rel(r, "Territory2.Name"), r.AffiliationRole].filter(Boolean).join(" · "),
              properties: { Territory: scalar(rel(r, "Territory2.Name")), "Account type": scalar(r.AccountType), Role: scalar(r.AffiliationRole) },
            })
          ),
        };
      }
    ),
    buildSurface(
      { id: "providerTerritoryInfo", title: "Provider Territory Info", lane: "alignment", description: "ProviderAcctTerritoryInfo — per-territory provider records that LSC alignment jobs maintain." },
      async () => {
        // Storage statistics, not COUNT(): both tables run to millions of rows in big orgs.
        const [pati, aligned] = await Promise.all([approxCount("ProviderAcctTerritoryInfo", org), approxCount("ObjectTerritory2Association", org)]);
        const about = (n: number | "some") => (n === "some" ? "Some" : n === 0 ? "No" : `About ${n.toLocaleString("en-US")}`);
        const findings: StudioFinding[] = [];
        if (pati === 0 && aligned !== 0) {
          findings.push({
            severity: "warning",
            title: "Not populated",
            detail: "Accounts are assigned to territories but there are no ProviderAcctTerritoryInfo records. Run the territory alignment batch jobs.",
          });
        }
        return {
          items: [
            item("pati", `${about(pati)} records`, {
              sublabel: `${about(aligned)} territory assignments`,
              properties: {
                "ProviderAcctTerritoryInfo records": pati === "some" ? "Some (not counted)" : pati,
                "Territory assignments": aligned === "some" ? "Some (not counted)" : aligned,
              },
            }),
          ],
          findings,
        };
      }
    ),
    buildSurface(
      { id: "fieldUsers", title: "Field Users", lane: "people", description: "Active users on LSC field profiles, with their territories and licenses." },
      async () => {
        const { total, users: rows, territoriesByUser } = await unwrap(fieldUsers);
        // The license fix needs the PSL's Id; without it the finding stands alone.
        const lscPsl = (await psls).ok ? (await unwrap(psls)).find((p) => LSC_PSL.test(String(p.DeveloperName))) : undefined;
        let noTerritory = 0;
        let noPsl = 0;
        const items = rows.map((u) => {
          const terrs = territoriesByUser.get(String(u.Id)) ?? [];
          const pslRows = (rel(u, "PermissionSetLicenseAssignments.records") as Row[] | undefined) ?? [];
          const psls = pslRows.map((a) => String(rel(a, "PermissionSetLicense.MasterLabel")));
          const findings: StudioFinding[] = [];
          if (terrs.length === 0) {
            noTerritory++;
            findings.push({ severity: "warning", title: "No territory", detail: "The user sees no aligned accounts in LSC." });
          }
          if (!pslRows.some((a) => LSC_PSL.test(String(rel(a, "PermissionSetLicense.DeveloperName"))))) {
            noPsl++;
            findings.push({
              severity: "warning",
              title: "No Life Science Commercial license",
              detail: "Assign the Life Science Commercial permission set license.",
              fixes: lscPsl
                ? [
                    {
                      kind: "assignPsl",
                      label: `Assign ${lscPsl.MasterLabel}`,
                      userId: String(u.Id),
                      userName: String(u.Name),
                      pslId: String(lscPsl.Id),
                      pslLabel: String(lscPsl.MasterLabel),
                    },
                  ]
                : undefined,
            });
          }
          return item(String(u.Id), String(u.Name), {
            sublabel: `${rel(u, "Profile.Name")} · ${terrs.length ? terrs.join(", ") : "no territory"}`,
            properties: {
              Username: scalar(u.Username),
              Profile: scalar(rel(u, "Profile.Name")),
              Role: scalar(rel(u, "UserRole.Name")),
              Territories: terrs.join(", ") || null,
              "Permission set licenses": psls.join(", ") || null,
            },
            audience: profileAudience(String(rel(u, "Profile.Name"))),
            checkProfile: u.Profile ? String(rel(u, "Profile.Name")) : undefined,
            user: { id: String(u.Id), name: String(u.Name) },
            findings,
          });
        });
        const findings: StudioFinding[] = [];
        // The counts cover only the users read; the title says so when there are more.
        const partial = total > rows.length ? ` (of the first ${rows.length.toLocaleString("en-US")})` : "";
        if (noTerritory) findings.push({ severity: "warning", title: `${noTerritory} users have no territory${partial}` });
        if (noPsl) findings.push({ severity: "warning", title: `${noPsl} users have no Life Science Commercial license${partial}` });
        if (total > rows.length) findings.push(showingNote(rows.length, total, "field users", "In name order"));
        fieldUserTotal = total;
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "usersByProfile", title: "Users by Profile", lane: "people", description: "Active users per profile." },
      async () => {
        const counts = await countBy(
          `SELECT Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY Profile.Name ORDER BY COUNT(Id) DESC`,
          "pn",
          org
        );
        const field = new Set(await unwrap(profiles));
        return {
          items: [...counts.entries()].map(([name, n]) =>
            item(`profile:${name}`, name, {
              sublabel: `${n} users${field.has(name) ? " · field profile" : ""}`,
              properties: { "Active users": n, "LSC field profile": field.has(name) },
              audience: profileAudience(name),
              checkProfile: name,
            })
          ),
        };
      }
    ),
    buildSurface(
      { id: "psls", title: "Permission Set Licenses", lane: "access", description: "LSC-related permission set licenses and capacity." },
      async () => {
        const rows = await unwrap(psls);
        return {
          items: rows.map((r) => {
            const used = Number(r.UsedLicenses ?? 0);
            const total = Number(r.TotalLicenses ?? 0);
            const findings: StudioFinding[] = [];
            if (total > 0 && used >= total) {
              findings.push({ severity: "error", title: "No licenses left", detail: `${used} of ${total} used — new users can't be provisioned.` });
            } else if (total > 0 && used / total >= 0.9) {
              findings.push({ severity: "warning", title: "Nearly full", detail: `${used} of ${total} used.` });
            }
            return item(String(r.Id), String(r.MasterLabel), {
              sublabel: `${used} / ${total} used`,
              active: r.Status ? r.Status === "Active" : undefined,
              properties: { "Developer name": scalar(r.DeveloperName), Used: used, Total: total, Status: scalar(r.Status) },
              findings,
            });
          }),
        };
      }
    ),
    buildSurface(
      { id: "permissionSets", title: "LSC Permission Sets", lane: "access", description: "LSC permission sets and how many users have each." },
      async () => {
        const rows = await query(`SELECT Id, Name, Label, NamespacePrefix FROM PermissionSet WHERE ${LSC_PS_FILTER} ORDER BY Label`, org);
        const counts = await countGroupedBy("PermissionSetAssignment", "PermissionSetId", rows.map((r) => String(r.Id)), org);
        return {
          items: rows.map((r) => {
            const n = counts.get(String(r.Id)) ?? 0;
            return item(String(r.Id), String(r.Label), {
              sublabel: `${n} users${r.NamespacePrefix ? ` · ${r.NamespacePrefix}` : ""}`,
              properties: { "API name": scalar(r.Name), Namespace: scalar(r.NamespacePrefix), "Assigned users": n },
            });
          }),
        };
      }
    ),
    buildSurface(
      { id: "territorySettings", title: "Territory Settings", lane: "access", description: "Admin Console territory management settings." },
      async () => ({
        items: (await fetchCategories(org, ["TerritoryManagement"])).map((r) => configItem(r, r.isOrgLevel ? "Org defaults" : r.label, r.category)),
      })
    ),
  ]);

  const territoryCount = territoryTotal || surfaces.find((s) => s.id === "territories")!.items.length;
  const userCount = fieldUserTotal || surfaces.find((s) => s.id === "fieldUsers")!.items.length;
  return {
    summary: `${territoryCount} territories · ${userCount} field users`,
    lanes: [
      { id: "model", title: "Territory model" },
      { id: "alignment", title: "Alignment" },
      { id: "people", title: "People" },
      { id: "access", title: "Licenses & access" },
    ],
    surfaces,
  };
};
