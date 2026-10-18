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

async function recentConfig(since: string, org: string): Promise<RecentChange[]> {
  const [rows, cats] = await Promise.all([
    query(
      `SELECT DeveloperName, MasterLabel, LifeSciConfigCategoryId, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigRecord WHERE LastModifiedDate >= ${since} ORDER BY LastModifiedDate DESC LIMIT 200`,
      org,
      true
    ),
    query(`SELECT Id, Category FROM LifeSciConfigCategory`, org, true),
  ]);
  const category = new Map(cats.map((c) => [c.Id as string, c.Category as string]));
  return rows.map((r) => {
    const cat = category.get(r.LifeSciConfigCategoryId as string) || "";
    const dev = r.DeveloperName as string;
    const featureId = featureForRecord({
      kind: "record",
      category: cat,
      developerName: dev,
      label: r.MasterLabel as string,
      fields: {},
    });
    return recent("config", (r.MasterLabel as string) || dev, featureId, r, cat);
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
        `SELECT DeveloperName, LastModifiedDate, LastModifiedBy.Name FROM ${object} WHERE DeveloperName IN (${inList(names.slice(i, i + 80).map((n) => byName.get(n)!.developerName))})`,
        org,
        true
      );
      for (const r of rows) {
        const c = byName.get(String(r.DeveloperName).toLowerCase());
        if (c) stamp(c, r);
      }
    }
  };
  // Authorship is a bonus: a failed lookup leaves the diff intact.
  await Promise.allSettled([run("record"), run("triggerHandler")]);
}
