/**
 * Who changed what, from the org itself: LSC configuration modified recently,
 * and the last editor of records that differ from a snapshot. Cheap queries only.
 */

import { FEATURES } from "./features.js";
import { featureForObject, featureForRecord, featureTitle } from "./drift-diff.js";
import { inList, query, type Row } from "./helpers.js";
import type { DriftChange, RecentChange, RecentChanges, RecentKind } from "./drift-types.js";

export const DEFAULT_DAYS = 14;

const LSC_OBJECTS = [...new Set(FEATURES.flatMap((f) => f.objects))];

const nameOf = (r: Row, rel = "LastModifiedBy") => ((r[rel] as Row | null)?.Name as string | undefined) ?? undefined;

function recent(kind: RecentKind, name: string, featureId: string | null, r: Row, detail?: string): RecentChange {
  return {
    kind,
    name,
    detail,
    featureId,
    featureTitle: featureTitle(featureId),
    modifiedAt: r.LastModifiedDate as string,
    modifiedBy: nameOf(r),
  };
}

/** The newer of two rows by LastModifiedDate. */
const newer = (a: Row | undefined, b: Row) => (!a || String(b.LastModifiedDate) > String(a.LastModifiedDate) ? b : a);

/**
 * Admin Console records changed since `since`. Editing a setting's value touches only its
 * field value row, and reassigning it only the assignment row, so all three count; each
 * record is listed once, stamped with its newest change.
 */
async function recentConfig(since: string, org: string): Promise<RecentChange[]> {
  const rel = "LifeSciConfigRecord.DeveloperName, LifeSciConfigRecord.MasterLabel, LifeSciConfigRecord.LifeSciConfigCategoryId";
  const [rows, values, assignments, cats] = await Promise.all([
    query(
      `SELECT Id, DeveloperName, MasterLabel, LifeSciConfigCategoryId, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigRecord WHERE LastModifiedDate >= ${since} ORDER BY LastModifiedDate DESC LIMIT 200`,
      org,
      true
    ),
    query(
      `SELECT LifeSciConfigRecordId, ${rel}, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigFieldValue WHERE LastModifiedDate >= ${since} ORDER BY LastModifiedDate DESC LIMIT 500`,
      org,
      true
    ),
    query(
      `SELECT LifeSciConfigRecordId, ${rel}, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigAssignment WHERE LastModifiedDate >= ${since} ORDER BY LastModifiedDate DESC LIMIT 500`,
      org,
      true
    ),
    query(`SELECT Id, Category FROM LifeSciConfigCategory`, org, true),
  ]);
  const category = new Map(cats.map((c) => [c.Id as string, c.Category as string]));
  // Record id → its identity and newest change.
  const byId = new Map<string, { dev: string; label: string; categoryId: string; latest: Row }>();
  for (const r of rows) {
    byId.set(String(r.Id), { dev: r.DeveloperName as string, label: r.MasterLabel as string, categoryId: r.LifeSciConfigCategoryId as string, latest: r });
  }
  for (const r of [...values, ...assignments]) {
    const rec = r.LifeSciConfigRecord as Row | null;
    if (!rec) continue;
    const id = String(r.LifeSciConfigRecordId);
    const known = byId.get(id);
    if (known) known.latest = newer(known.latest, r);
    else byId.set(id, { dev: rec.DeveloperName as string, label: rec.MasterLabel as string, categoryId: rec.LifeSciConfigCategoryId as string, latest: r });
  }
  return [...byId.values()].map(({ dev, label, categoryId, latest }) => {
    const cat = category.get(categoryId) || "";
    const featureId = featureForRecord({ kind: "record", category: cat, developerName: dev, label, fields: {} });
    return recent("config", label || dev, featureId, latest, cat);
  });
}

async function recentHandlers(since: string, org: string): Promise<RecentChange[]> {
  const rows = await query(
    `SELECT DeveloperName, MasterLabel, LastModifiedDate, LastModifiedBy.Name FROM LifeScienceTriggerHandler WHERE LastModifiedDate >= ${since} ORDER BY LastModifiedDate DESC LIMIT 100`,
    org,
    true
  );
  return rows.map((r) =>
    recent(
      "triggerHandler",
      (r.MasterLabel as string) || (r.DeveloperName as string),
      featureForRecord({ kind: "triggerHandler", category: "TriggerHandler", developerName: r.DeveloperName as string, label: r.MasterLabel as string, fields: {} }),
      r,
      "Trigger handler"
    )
  );
}

async function recentValidationRules(since: string, org: string): Promise<RecentChange[]> {
  const rows = await query(
    `SELECT ValidationName, EntityDefinition.QualifiedApiName, LastModifiedDate, LastModifiedBy.Name FROM ValidationRule WHERE LastModifiedDate >= ${since} AND EntityDefinition.QualifiedApiName IN (${inList(LSC_OBJECTS)}) ORDER BY LastModifiedDate DESC LIMIT 100`,
    org,
    true
  );
  return rows.map((r) => {
    const object = (r.EntityDefinition as Row | null)?.QualifiedApiName as string | undefined;
    return recent("validationRule", r.ValidationName as string, featureForObject(object), r, object);
  });
}

async function recentApexTriggers(since: string, org: string): Promise<RecentChange[]> {
  const rows = await query(
    `SELECT Name, TableEnumOrId, LastModifiedDate, LastModifiedBy.Name FROM ApexTrigger WHERE LastModifiedDate >= ${since} AND TableEnumOrId IN (${inList(LSC_OBJECTS)}) ORDER BY LastModifiedDate DESC LIMIT 100`,
    org,
    true
  );
  return rows.map((r) => recent("apexTrigger", r.Name as string, featureForObject(r.TableEnumOrId as string), r, r.TableEnumOrId as string));
}

async function recentLayouts(since: string, org: string): Promise<RecentChange[]> {
  const rows = await query(
    `SELECT Name, TableEnumOrId, LastModifiedDate, LastModifiedBy.Name FROM Layout WHERE LastModifiedDate >= ${since} AND TableEnumOrId IN (${inList(LSC_OBJECTS)}) AND NamespacePrefix = null ORDER BY LastModifiedDate DESC LIMIT 100`,
    org,
    true
  );
  return rows.map((r) => recent("layout", r.Name as string, featureForObject(r.TableEnumOrId as string), r, r.TableEnumOrId as string));
}

async function recentFlows(since: string, org: string): Promise<RecentChange[]> {
  const rows = await query(
    `SELECT ApiName, Label, TriggerObjectOrEventLabel, LastModifiedDate FROM FlowDefinitionView WHERE LastModifiedDate >= ${since} AND TriggerType IN ('RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete') ORDER BY LastModifiedDate DESC LIMIT 100`,
    org
  );
  // The trigger object comes as a label ("Visit"); match it against feature objects loosely.
  return rows.map((r) => {
    const object = r.TriggerObjectOrEventLabel as string | undefined;
    return recent("flow", (r.Label as string) || (r.ApiName as string), featureForObject(object?.replace(/\s+/g, "")), r, object);
  });
}

/** Configuration modified in the last `days` days, newest first. A source that fails is reported, not fatal. */
export async function recentChanges(org: string, days = DEFAULT_DAYS): Promise<RecentChanges> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const sources: Array<[string, Promise<RecentChange[]>]> = [
    ["Admin Console records", recentConfig(since, org)],
    ["Trigger handlers", recentHandlers(since, org)],
    ["Validation rules", recentValidationRules(since, org)],
    ["Apex triggers", recentApexTriggers(since, org)],
    ["Page layouts", recentLayouts(since, org)],
    ["Flows", recentFlows(since, org)],
  ];
  const settled = await Promise.allSettled(sources.map(([, p]) => p));
  const changes: RecentChange[] = [];
  const errors: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") changes.push(...s.value);
    else errors.push(`${sources[i][0]}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
  });
  changes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { days, changes, errors };
}

/** Fill in modifiedAt / modifiedBy on diff changes from the live records that still exist. */
export async function attachModifiers(changes: DriftChange[], org: string): Promise<void> {
  const targets = changes.filter((c) => c.kind !== "removed");
  const stamp = (c: DriftChange, r: Row) => {
    c.modifiedAt = r.LastModifiedDate as string;
    c.modifiedBy = nameOf(r);
  };
  const run = async (kind: "record" | "triggerHandler") => {
    const mine = targets.filter((c) => (c.category === "TriggerHandler") === (kind === "triggerHandler"));
    const byName = new Map(mine.map((c) => [c.developerName.toLowerCase(), c]));
    const names = [...byName.keys()];
    const object = kind === "triggerHandler" ? "LifeScienceTriggerHandler" : "LifeSciConfigRecord";
    for (let i = 0; i < names.length; i += 80) {
      const rows = await query(
        `SELECT Id, DeveloperName, LastModifiedDate, LastModifiedBy.Name FROM ${object} WHERE DeveloperName IN (${inList(names.slice(i, i + 80).map((n) => byName.get(n)!.developerName))})`,
        org,
        true
      );
      // An Admin Console record's newest change may be on a field value or assignment row.
      const latest = new Map(rows.map((r) => [String(r.Id), r]));
      if (kind === "record" && rows.length) {
        const ids = inList([...latest.keys()]);
        const children = await Promise.all(
          ["LifeSciConfigFieldValue", "LifeSciConfigAssignment"].map((child) =>
            query(`SELECT LifeSciConfigRecordId, LastModifiedDate, LastModifiedBy.Name FROM ${child} WHERE LifeSciConfigRecordId IN (${ids})`, org, true).catch(
              () => [] as Row[]
            )
          )
        );
        for (const r of children.flat()) {
          const id = String(r.LifeSciConfigRecordId);
          const parent = latest.get(id);
          if (parent && newer(parent, r) === r) latest.set(id, { ...r, DeveloperName: parent.DeveloperName });
        }
      }
      for (const r of latest.values()) {
        const c = byName.get(String(r.DeveloperName).toLowerCase());
        if (c) stamp(c, r);
      }
    }
  };
  // Authorship is a bonus: a failed lookup leaves the diff intact.
  await Promise.allSettled([run("record"), run("triggerHandler")]);
}
