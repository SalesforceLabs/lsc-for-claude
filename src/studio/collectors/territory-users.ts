/**
 * Territory & Users — the territory model, how accounts are aligned to it,
 * which field users sit in it, and whether they're licensed.
 */

import type { CustomCollector } from "../collect.js";
import type { StudioFinding, StudioItem } from "../types.js";
import { buildSurface, configItem, count, inList, item, profileAudience, query, scalar, settle, unwrap, type Row } from "../helpers.js";
import { fetchCategories, profilesOf } from "./shared.js";

const LSC_PSL_FILTER = `DeveloperName LIKE '%LSC4CE%' OR DeveloperName LIKE '%LifeScience%' OR DeveloperName LIKE '%HealthCloud%' OR DeveloperName LIKE '%IndustrySales%' OR DeveloperName LIKE '%CLM%' OR DeveloperName LIKE '%SampleManagement%'`;
const LSC_PS_FILTER = `(NamespacePrefix IN ('lsc4ce', 'HealthCloudGA') OR Label LIKE '%Life Science%' OR Label LIKE '%Sample%' OR Label LIKE '%CLM%') AND IsOwnedByProfile = false`;
const USER_LIMIT = 500;
/** The Life Sciences Commercial PSL every LSC user needs. */
const LSC_PSL = /LSC4CE|LifeScienceCommercial/i;

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

/** COUNT(Id) grouped by `key` → Map. */
async function countBy(soql: string, key: string, org: string): Promise<Map<string, number>> {
  const rows = await query(soql, org);
  return new Map(rows.map((r) => [String(r[key]), Number(r.cnt ?? r.expr0 ?? 0)]));
}

/** Field profiles — those with LSC Mobile app settings; falls back to a name heuristic. */
async function fieldProfiles(org: string): Promise<string[]> {
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
  const territories = settle(
    query(
      `SELECT Id, Name, DeveloperName, Territory2ModelId, Territory2Model.State, Territory2Type.MasterLabel, ParentTerritory2Id, ParentTerritory2.Name FROM Territory2 ORDER BY Name LIMIT 2000`,
      org
    )
  );
  const usersPerTerritory = settle(
    countBy(`SELECT Territory2Id, COUNT(Id) cnt FROM UserTerritory2Association GROUP BY Territory2Id`, "Territory2Id", org)
  );
  const accountsPerTerritory = settle(
    countBy(
      `SELECT Territory2Id, COUNT(Id) cnt FROM ObjectTerritory2Association WHERE SobjectType = 'Account' GROUP BY Territory2Id`,
      "Territory2Id",
      org
    )
  );
  const profiles = settle(fieldProfiles(org));
  const fieldUsers = settle(
    unwrap(profiles).then(async (names) => {
      if (names.length === 0) return [] as Row[];
      return query(
        `SELECT Id, Name, Username, Profile.Name, UserRole.Name, (SELECT Territory2.Name FROM UserTerritory2Associations), (SELECT PermissionSetLicense.MasterLabel, PermissionSetLicense.DeveloperName FROM PermissionSetLicenseAssignments) FROM User WHERE IsActive = true AND Profile.Name IN (${inList(names)}) ORDER BY Name LIMIT ${USER_LIMIT}`,
        org
      );
    })
  );

  const psls = settle(
    query(
      `SELECT Id, DeveloperName, MasterLabel, TotalLicenses, UsedLicenses, Status FROM PermissionSetLicense WHERE ${LSC_PSL_FILTER} ORDER BY MasterLabel`,
      org
    )
  );

  const activeModel = async () => (await unwrap(models)).find((m) => m.State === "Active");

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
        const [rows, users, accounts, model] = await Promise.all([
          unwrap(territories),
          unwrap(usersPerTerritory),
          unwrap(accountsPerTerritory),
          activeModel(),
        ]);
        const inModel = model ? rows.filter((t) => t.Territory2ModelId === model.Id) : rows;
        const parents = new Set(inModel.map((t) => t.ParentTerritory2Id).filter(Boolean));
        let emptyLeaves = 0;
        const items: StudioItem[] = inModel.map((t) => {
          const id = String(t.Id);
          const u = users.get(id) ?? 0;
          const a = accounts.get(id) ?? 0;
          if (u === 0 && !parents.has(t.Id)) emptyLeaves++;
          return item(id, String(t.Name), {
            sublabel: [rel(t, "Territory2Type.MasterLabel"), rel(t, "ParentTerritory2.Name") && `in ${rel(t, "ParentTerritory2.Name")}`]
              .filter(Boolean)
              .join(" · "),
            properties: {
              "Developer name": scalar(t.DeveloperName),
              Type: scalar(rel(t, "Territory2Type.MasterLabel")),
              Parent: scalar(rel(t, "ParentTerritory2.Name")),
              Users: u,
              "Explicit accounts": a,
            },
          });
        });
        return {
          items,
          findings: emptyLeaves
            ? [{ severity: "info", title: `${emptyLeaves} leaf territories have no users`, detail: "Accounts aligned to them aren't covered by a rep — check for vacancies or leftover territories." }]
            : [],
        };
      }
    ),
    buildSurface(
      { id: "explicitAssignments", title: "Explicit Assignments", lane: "alignment", description: "ObjectTerritory2Association — accounts assigned to territories, by territory." },
      async () => {
        const [rows, accounts] = await Promise.all([unwrap(territories), unwrap(accountsPerTerritory)]);
        const names = new Map(rows.map((t) => [String(t.Id), String(t.Name)]));
        const items = [...accounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) =>
            item(`ota:${id}`, names.get(id) ?? id, { sublabel: `${n} accounts`, properties: { Territory: names.get(id) ?? id, Accounts: n } })
          );
        return { items };
      }
    ),
    buildSurface(
      { id: "geoRules", title: "Geo Rules", lane: "alignment", description: "TerritoryGeoAssignmentRule — postal-code / geography based alignment." },
      async () => {
        const rows = await optionalQuery(
          `SELECT Id, Name, Territory2Id, Territory2.Name, UsageType, IsActive FROM TerritoryGeoAssignmentRule ORDER BY UsageType, Territory2.Name LIMIT 500`,
          org
        );
        if (!rows) return { items: [], findings: [NOT_AVAILABLE] };
        return {
          items: rows.map((r) =>
            item(String(r.Id), String(r.Name), {
              sublabel: [rel(r, "Territory2.Name"), r.UsageType].filter(Boolean).join(" · "),
              active: r.IsActive as boolean,
              properties: { Territory: scalar(rel(r, "Territory2.Name")), Usage: scalar(r.UsageType) },
            })
          ),
        };
      }
    ),
    buildSurface(
      { id: "affiliationRules", title: "Affiliation Rules", lane: "alignment", description: "TerritoryProviderAffiliationAlignmentRule — align providers through their affiliations." },
      async () => {
        const rows = await optionalQuery(
          `SELECT Id, Name, Territory2Id, Territory2.Name, AccountType, AffiliationRole, IsActive FROM TerritoryProviderAffiliationAlignmentRule ORDER BY Territory2.Name LIMIT 500`,
          org
        );
        if (!rows) return { items: [], findings: [NOT_AVAILABLE] };
        return {
          items: rows.map((r) =>
            item(String(r.Id), String(r.Name), {
              sublabel: [rel(r, "Territory2.Name"), r.AffiliationRole].filter(Boolean).join(" · "),
              active: r.IsActive as boolean,
              properties: { Territory: scalar(rel(r, "Territory2.Name")), "Account type": scalar(r.AccountType), Role: scalar(r.AffiliationRole) },
            })
          ),
        };
      }
    ),
    buildSurface(
      { id: "providerTerritoryInfo", title: "Provider Territory Info", lane: "alignment", description: "ProviderAcctTerritoryInfo — per-territory provider records that LSC alignment jobs maintain." },
      async () => {
        const [pati, accounts] = await Promise.all([count(`SELECT COUNT() FROM ProviderAcctTerritoryInfo`, org), unwrap(accountsPerTerritory)]);
        const aligned = [...accounts.values()].reduce((a, b) => a + b, 0);
        const findings: StudioFinding[] = [];
        if (pati === 0 && aligned > 0) {
          findings.push({
            severity: "warning",
            title: "Not populated",
            detail: `${aligned} accounts are aligned but there are no ProviderAcctTerritoryInfo records. Run the territory alignment batch jobs.`,
          });
        }
        return {
          items: [
            item("pati", `${pati} records`, {
              sublabel: `${aligned} explicit account assignments`,
              properties: { "ProviderAcctTerritoryInfo records": pati, "Explicit account assignments": aligned },
            }),
          ],
          findings,
        };
      }
    ),
    buildSurface(
      { id: "fieldUsers", title: "Field Users", lane: "people", description: "Active users on LSC field profiles, with their territories and licenses." },
      async () => {
        const rows = await unwrap(fieldUsers);
        // The license fix needs the PSL's Id; without it the finding stands alone.
        const lscPsl = (await psls).ok ? (await unwrap(psls)).find((p) => LSC_PSL.test(String(p.DeveloperName))) : undefined;
        let noTerritory = 0;
        let noPsl = 0;
        const items = rows.map((u) => {
          const terrs = ((rel(u, "UserTerritory2Associations.records") as Row[] | undefined) ?? []).map((a) => String(rel(a, "Territory2.Name")));
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
        if (noTerritory) findings.push({ severity: "warning", title: `${noTerritory} users have no territory` });
        if (noPsl) findings.push({ severity: "warning", title: `${noPsl} users have no Life Science Commercial license` });
        if (rows.length === USER_LIMIT) findings.push({ severity: "info", title: `Showing the first ${USER_LIMIT} users` });
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
        const rows = await query(`SELECT Id, Name, Label, NamespacePrefix FROM PermissionSet WHERE ${LSC_PS_FILTER} ORDER BY Label LIMIT 200`, org);
        const counts = rows.length
          ? await countBy(
              `SELECT PermissionSetId, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSetId IN (${rows.map((r) => `'${r.Id}'`).join(",")}) GROUP BY PermissionSetId`,
              "PermissionSetId",
              org
            )
          : new Map<string, number>();
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

  const territoryCount = surfaces.find((s) => s.id === "territories")!.items.length;
  const userCount = surfaces.find((s) => s.id === "fieldUsers")!.items.length;
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
