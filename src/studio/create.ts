/**
 * Studio "add" changes — new Admin Console records (quick/custom actions,
 * navigation tabs, DB Schema, …), and deleting one again (the undo of a create).
 *
 * A record is created inactive, then its field values and assignments, then
 * activated — the Tooling API checks required field values exist when a record
 * is active, and they can only be added once the record exists. If any step
 * fails, everything created so far is deleted.
 */

import type { FixTracker } from "./fix-progress.js";
import {
  createToolingRecord,
  deleteToolingRecord,
  updateToolingRecord,
} from "../salesforce/cli.js";
import { extractFieldValue, getValueColumn, queryFieldValues } from "../tools/helpers.js";
import {
  assertNames,
  audienceWarnings,
  display,
  findConfigRecord,
  MOBILE_CATEGORIES,
  PUBLISH_WARNING,
} from "./change-helpers.js";
import { actionProfiles, fetchCategories, isNavTab, profilesOf } from "./collectors/shared.js";
import { inList, query, splitList, type Row } from "./helpers.js";
import type {
  ConfigFieldInput,
  CreateConfigFix,
  FixChange,
  FixPreview,
  FixResult,
  StudioFix,
} from "./types.js";

type DeleteFix = Extract<StudioFix, { kind: "deleteConfigRecord" }>;
type Value = ConfigFieldInput["value"];

/** Data types of the fields Studio's forms fill in, per category — as the create_* tools write them. */
const FIELD_TYPES: Record<string, Record<string, string>> = {
  QuickAction: {
    Location: "PICKLIST",
    ActionName: "PICKLIST",
    SortOrder: "INTEGER",
    Profiles: "TEXT",
  },
  CustomAction: {
    EntityType: "PICKLIST",
    ActionType: "PICKLIST",
    ActionTarget: "TEXT",
    TargetType: "PICKLIST",
    TargetParameters: "TEXT",
    EntityName: "TEXT",
    Profiles: "TEXT",
  },
  UISchema: { Type: "PICKLIST", TabName: "TEXT", TabOrder: "NUMBER" },
  DbSchema: {
    SObject: "OBJECT",
    Type: "PICKLIST",
    WhereSoql: "LONGTEXT",
    DeltaDateField: "FIELD",
    OneWaySync: "BOOLEAN",
    AttachmentsSupport: "PICKLIST",
    Status: "PICKLIST",
    MandatoryFields: "LONGTEXT",
    PermissionSets: "LONGTEXT",
  },
};

/** Fields a new record can't do without. */
const REQUIRED: Record<string, string[]> = {
  QuickAction: ["Location", "ActionName"],
  CustomAction: ["EntityType", "ActionType", "ActionTarget"],
  UISchema: ["Type", "TabName", "TabOrder"],
  DbSchema: ["SObject", "Type"],
};

/** The full field set create_db_schema writes, so a DB Schema record made in Studio matches one made there. */
const DB_SCHEMA_DEFAULTS: { name: string; value: Value }[] = [
  { name: "Type", value: "DATA" },
  { name: "WhereSoql", value: "" },
  { name: "DeltaDateField", value: "LastModifiedDate" },
  { name: "OneWaySync", value: false },
  { name: "AttachmentsSupport", value: "" },
  { name: "Status", value: "VALID" },
  { name: "MandatoryFields", value: "" },
  { name: "PermissionSets", value: "" },
];

const HOME_PAGE_LIMIT = 5;

/** Salesforce API name rules; null when the name is fine. */
export function developerNameProblem(name: string): string | null {
  if (!name) return "Enter an API name.";
  if (name.length > 80) return "The API name must be 80 characters or fewer.";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
    return "The API name must start with a letter and use only letters, numbers, and underscores.";
  if (name.includes("__") || name.endsWith("_"))
    return "The API name can't have two underscores in a row or end with one.";
  return null;
}

interface Field {
  name: string;
  dataType: string;
  value: Value;
}

export interface Assignee {
  name: string;
  id: string;
}

/** Everything about an existing record needed to recreate it. */
interface Snapshot {
  recordId: string;
  label: string;
  active: boolean;
  fields: Field[];
  profiles: string[];
  permissionSets: string[];
  fieldValueIds: string[];
  assignmentIds: string[];
}

async function snapshot(rec: Row, org: string): Promise<Snapshot> {
  const recordId = String(rec.Id);
  const { fieldValuesByRecord, queryError } = await queryFieldValues([recordId], org);
  if (queryError) throw new Error(queryError);
  const fvs = fieldValuesByRecord.get(recordId) ?? [];
  const assignments = await query(
    `SELECT Id, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId = '${recordId}'`,
    org,
    true
  );
  const names = async (sobject: string, level: string) => {
    const ids = assignments
      .filter((a) => a.AssignmentLevel === level)
      .map((a) => String(a.AssignedToId));
    if (!ids.length) return [];
    const rows = await query(`SELECT Id, Name FROM ${sobject} WHERE Id IN (${inList(ids)})`, org);
    return rows.map((r) => String(r.Name));
  };
  return {
    recordId,
    label: String(rec.MasterLabel ?? ""),
    active: !!rec.IsActive,
    fields: fvs.map((f) => ({
      name: String(f.FieldName),
      dataType: String(f.DataType),
      value: extractFieldValue(f) as Value,
    })),
    profiles: await names("Profile", "Profile"),
    permissionSets: await names("PermissionSet", "PermissionSet"),
    fieldValueIds: fvs.map((f) => String(f.Id)),
    assignmentIds: assignments.map((a) => String(a.Id)),
  };
}

/** Name → Id for the given names (case-insensitive), from `Profile` or `PermissionSet`. */
export async function resolveNames(
  sobject: "Profile" | "PermissionSet",
  names: string[],
  org: string
): Promise<{ found: Assignee[]; missing: string[] }> {
  if (!names.length) return { found: [], missing: [] };
  const rows = await query(`SELECT Id, Name FROM ${sobject} WHERE Name IN (${inList(names)})`, org);
  const byName = new Map(rows.map((r) => [String(r.Name).toLowerCase(), String(r.Id)]));
  return {
    found: names
      .filter((n) => byName.has(n.toLowerCase()))
      .map((n) => ({ name: n, id: byName.get(n.toLowerCase())! })),
    missing: names.filter((n) => !byName.has(n.toLowerCase())),
  };
}

const isBlank = (v: Value | undefined) => v === undefined || v === null || v === "";

// --- Create -------------------------------------------------------------------

interface CreatePlan {
  categoryId: string;
  fields: Field[];
  profiles: Assignee[];
  permissionSets: Assignee[];
}

/** Collisions with records already in the category: tab positions, the home page action limit, duplicate syncs. */
async function contextWarnings(
  fix: CreateConfigFix,
  fields: Map<string, Field>,
  audience: string[],
  org: string
): Promise<string[]> {
  const value = (name: string) => fields.get(name)?.value;
  const relevant =
    fix.category === "UISchema" ||
    fix.category === "DbSchema" ||
    (fix.category === "QuickAction" && value("Location") === "HomePage");
  if (!relevant || !fix.active) return [];
  const records = (await fetchCategories(org, [fix.category])).filter((r) => r.isActive);
  const lower = new Set(fix.profiles.map((p) => p.toLowerCase()));
  const overlap = (names: string[]) => names.filter((n) => lower.has(n.toLowerCase()));
  const warnings: string[] = [];

  if (fix.category === "UISchema") {
    for (const tab of records.filter(
      (r) => isNavTab(r) && Number(r.fields.TabOrder) === Number(value("TabOrder"))
    )) {
      const shared = overlap(profilesOf(tab));
      if (shared.length) {
        warnings.push(
          `Position ${value("TabOrder")} is already "${tab.label || tab.developerName}" for ${shared.join(", ")}, so their order is unpredictable.`
        );
      }
    }
  }
  if (fix.category === "QuickAction") {
    for (const profile of audience) {
      const n = records.filter((r) => {
        if (r.fields.Location !== "HomePage") return false;
        const who = actionProfiles(r);
        return who.length === 0 || who.some((p) => p.toLowerCase() === profile.toLowerCase());
      }).length;
      if (n >= HOME_PAGE_LIMIT)
        warnings.push(
          `${profile} already has ${n} home page actions — the iPad shows at most ${HOME_PAGE_LIMIT}.`
        );
    }
  }
  if (fix.category === "DbSchema") {
    const obj = String(value("SObject") ?? "").toLowerCase();
    for (const r of records.filter((r) => String(r.fields.SObject ?? "").toLowerCase() === obj)) {
      const shared = overlap(profilesOf(r));
      if (shared.length)
        warnings.push(
          `${r.developerName} already syncs ${value("SObject")} for ${shared.join(", ")}.`
        );
    }
  }
  return warnings;
}

export async function previewCreate(
  fix: CreateConfigFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { plan?: CreatePlan }> {
  progress?.begin("read");
  assertNames(fix.category);
  const preview: FixPreview = { org, title: fix.label, changes: [], warnings: [] };
  const block = (blocked: string) => ({ ...preview, blocked });

  const nameProblem = developerNameProblem(fix.developerName);
  if (nameProblem) return block(nameProblem);
  if (!fix.recordLabel.trim() || fix.recordLabel.length > 80)
    return block("Enter a label of 80 characters or fewer.");

  // Merge: the copied record's values (or DB Schema defaults), then the form's.
  const fields = new Map<string, Field>();
  let permissionSets = fix.permissionSets;
  if (fix.copyFrom) {
    const source = await findConfigRecord(fix.category, fix.copyFrom, org);
    if (!source) return block(`${fix.copyFrom} no longer exists, so there's nothing to copy.`);
    const snap = await snapshot(source, org);
    for (const f of snap.fields) fields.set(f.name, f);
    permissionSets ??= snap.permissionSets;
  } else if (fix.category === "DbSchema") {
    for (const f of DB_SCHEMA_DEFAULTS)
      fields.set(f.name, { ...f, dataType: FIELD_TYPES.DbSchema[f.name] });
  }
  for (const f of fix.fields) {
    assertNames(f.name);
    const dataType =
      f.dataType ?? fields.get(f.name)?.dataType ?? FIELD_TYPES[fix.category]?.[f.name];
    if (!dataType) return block(`Studio doesn't know what kind of value ${f.name} holds.`);
    fields.set(f.name, { name: f.name, dataType, value: f.value });
  }

  const fieldProfiles =
    "Profiles" in (FIELD_TYPES[fix.category] ?? {}) ? splitList(fields.get("Profiles")?.value) : [];
  const assigned = (names: string[]) => (names.length ? names.join(";") : null);
  const changes: FixChange[] = [
    {
      target: fix.recordLabel,
      field: "New record",
      before: "—",
      after: `${fix.category} · ${fix.developerName}`,
    },
    ...(fix.copyFrom
      ? [{ target: fix.recordLabel, field: "Copied from", before: "—", after: fix.copyFrom }]
      : []),
    ...[...fields.values()].map((f) => ({
      target: fix.recordLabel,
      field: f.name,
      before: "—",
      after: display(f.value),
    })),
    ...(assigned(fix.profiles)
      ? [
          {
            target: fix.recordLabel,
            field: "Assigned profiles",
            before: "—",
            after: assigned(fix.profiles)!,
          },
        ]
      : []),
    ...(assigned(permissionSets ?? [])
      ? [
          {
            target: fix.recordLabel,
            field: "Assigned permission sets",
            before: "—",
            after: assigned(permissionSets!)!,
          },
        ]
      : []),
    {
      target: fix.recordLabel,
      field: "Status",
      before: "—",
      after: fix.active ? "Active" : "Inactive",
    },
  ];
  preview.changes = changes;

  const missingFields = (REQUIRED[fix.category] ?? []).filter((n) => isBlank(fields.get(n)?.value));
  if (missingFields.length) return block(`Fill in ${missingFields.join(", ")}.`);

  const [category] = await query(
    `SELECT Id FROM LifeSciConfigCategory WHERE Category = '${fix.category}' LIMIT 1`,
    org,
    true
  );
  if (!category) return block(`The ${fix.category} category doesn't exist in this org.`);
  const [existing] = await query(
    `SELECT Id FROM LifeSciConfigRecord WHERE DeveloperName = '${fix.developerName}' LIMIT 1`,
    org,
    true
  );
  if (existing)
    return block(`A record named ${fix.developerName} already exists. Pick another API name.`);

  if (fix.category === "DbSchema") {
    const obj = String(fields.get("SObject")!.value);
    const [entity] = await query(
      `SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN (${inList([obj])})`,
      org,
      true
    );
    if (!entity) return block(`${obj} isn't an object in this org.`);
  }

  const profiles = await resolveNames("Profile", fix.profiles, org);
  if (profiles.missing.length) return block(`Profile not found: ${profiles.missing.join(", ")}.`);
  const sets = await resolveNames("PermissionSet", permissionSets ?? [], org);
  if (sets.missing.length) return block(`Permission set not found: ${sets.missing.join(", ")}.`);

  progress?.end("read");
  progress?.begin("reach");
  const audience = [
    ...new Map([...fix.profiles, ...fieldProfiles].map((n) => [n.toLowerCase(), n])).values(),
  ];
  if (!fix.active) {
    preview.warnings.push("Created switched off — nobody sees it until it's activated.");
  } else if (audience.length || sets.found.length) {
    preview.warnings.push(...(await audienceWarnings([], audience, org)));
  } else {
    preview.warnings.push(
      fieldProfiles.length === 0 && "Profiles" in (FIELD_TYPES[fix.category] ?? {})
        ? "With no profiles listed, every profile sees this."
        : "No profile will see this until it's assigned."
    );
  }
  const unknown = await resolveNames("Profile", fieldProfiles, org);
  if (unknown.missing.length)
    preview.warnings.push(`Not a profile in this org: ${unknown.missing.join(", ")}.`);
  preview.warnings.push(...(await contextWarnings(fix, fields, audience, org)));
  if (fix.active && MOBILE_CATEGORIES.has(fix.category)) preview.warnings.push(PUBLISH_WARNING);

  return {
    ...preview,
    plan: {
      categoryId: String(category.Id),
      fields: [...fields.values()],
      profiles: profiles.found,
      permissionSets: sets.found,
    },
  };
}

export async function applyCreate(
  fix: CreateConfigFix,
  org: string,
  progress?: FixTracker
): Promise<FixResult> {
  const preview = await previewCreate(fix, org, progress);
  if (preview.blocked || !preview.plan)
    return { ok: false, message: preview.blocked || "Nothing to create." };
  const { plan } = preview;
  progress?.end("reach");
  progress?.begin("write");
  const totalWrites =
    1 +
    plan.fields.length +
    plan.profiles.length +
    plan.permissionSets.length +
    (fix.active ? 1 : 0);
  let writes = 0;
  const wrote = () => progress?.detail("write", `${++writes} of ${totalWrites} records`);

  const created = await createToolingRecord(
    "LifeSciConfigRecord",
    {
      DeveloperName: fix.developerName,
      MasterLabel: fix.recordLabel,
      LifeSciConfigCategoryId: plan.categoryId,
      IsActive: false,
      IsOrgLevel: false,
    },
    org
  );
  if (!created.success || !created.data?.id) {
    return {
      ok: false,
      message: `Couldn't create ${fix.recordLabel}: ${created.error || "unknown error"}.`,
    };
  }
  const recordId = created.data.id;
  wrote();
  const children: { sobject: string; id: string }[] = [];
  const fail = async (step: string, error?: string): Promise<FixResult> => {
    for (const c of children.reverse()) await deleteToolingRecord(c.sobject, c.id, org);
    await deleteToolingRecord("LifeSciConfigRecord", recordId, org);
    progress?.fail("write");
    return {
      ok: false,
      message: `Couldn't ${step}: ${error || "unknown error"}. Nothing was created.`,
    };
  };

  for (const f of plan.fields) {
    const res = await createToolingRecord(
      "LifeSciConfigFieldValue",
      {
        LifeSciConfigRecordId: recordId,
        FieldName: f.name,
        DataType: f.dataType,
        [getValueColumn(f.dataType)]: f.value,
      },
      org
    );
    if (!res.success || !res.data?.id) return fail(`set ${f.name}`, res.error);
    children.push({ sobject: "LifeSciConfigFieldValue", id: res.data.id });
    wrote();
  }
  const assignees = [
    ...plan.profiles.map((a) => ({ ...a, level: "Profile" })),
    ...plan.permissionSets.map((a) => ({ ...a, level: "PermissionSet" })),
  ];
  for (const a of assignees) {
    const res = await createToolingRecord(
      "LifeSciConfigAssignment",
      { LifeSciConfigRecordId: recordId, AssignedToId: a.id, AssignmentLevel: a.level },
      org
    );
    if (!res.success || !res.data?.id) return fail(`assign ${a.name}`, res.error);
    children.push({ sobject: "LifeSciConfigAssignment", id: res.data.id });
    wrote();
  }
  if (fix.active) {
    const res = await updateToolingRecord("LifeSciConfigRecord", recordId, { IsActive: true }, org);
    if (!res.success) return fail("activate it", res.error);
    wrote();
  }
  progress?.end("write");

  return {
    ok: true,
    message: `Created ${fix.recordLabel}${fix.active ? "" : " (switched off)"}.`,
    undo: {
      kind: "deleteConfigRecord",
      label: `Delete ${fix.recordLabel}`,
      category: fix.category,
      developerName: fix.developerName,
      recordLabel: fix.recordLabel,
    },
  };
}

// --- Delete (the undo of a create) ---------------------------------------------

export async function previewDelete(
  fix: DeleteFix,
  org: string,
  progress?: FixTracker
): Promise<FixPreview & { snapshot?: Snapshot }> {
  progress?.begin("read");
  const preview: FixPreview = {
    org,
    title: fix.label,
    changes: [
      {
        target: fix.recordLabel,
        field: "Record",
        before: `${fix.category} · ${fix.developerName}`,
        after: "(deleted)",
      },
    ],
    warnings: [],
  };
  const rec = await findConfigRecord(fix.category, fix.developerName, org);
  if (!rec) return { ...preview, blocked: "Already deleted. Refresh the map." };
  if (rec.IsOrgLevel)
    return { ...preview, blocked: "Org-level defaults can't be deleted from Studio." };
  const snap = await snapshot(rec, org);
  progress?.end("read");
  if (snap.active) {
    progress?.begin("reach");
    const fieldProfiles = splitList(snap.fields.find((f) => f.name === "Profiles")?.value);
    preview.warnings.push(
      ...(await audienceWarnings([...snap.profiles, ...fieldProfiles], [], org))
    );
    if (MOBILE_CATEGORIES.has(fix.category)) preview.warnings.push(PUBLISH_WARNING);
  }
  return { ...preview, snapshot: snap };
}

export async function applyDelete(
  fix: DeleteFix,
  org: string,
  progress?: FixTracker
): Promise<FixResult> {
  const preview = await previewDelete(fix, org, progress);
  if (preview.blocked || !preview.snapshot)
    return { ok: false, message: preview.blocked || "Nothing to delete." };
  const snap = preview.snapshot;
  progress?.end("reach");
  progress?.begin("write");
  const steps = [
    ...snap.fieldValueIds.map((id) => ({ sobject: "LifeSciConfigFieldValue", id })),
    ...snap.assignmentIds.map((id) => ({ sobject: "LifeSciConfigAssignment", id })),
    { sobject: "LifeSciConfigRecord", id: snap.recordId },
  ];
  // Salesforce won't delete the required field values of an active record, so switch it off first.
  if (snap.active) {
    const off = await updateToolingRecord(
      "LifeSciConfigRecord",
      snap.recordId,
      { IsActive: false },
      org
    );
    if (!off.success) {
      return {
        ok: false,
        message: `Couldn't switch off ${fix.recordLabel} before deleting it: ${off.error || "unknown error"}. Nothing was deleted.`,
      };
    }
  }
  for (const [i, step] of steps.entries()) {
    progress?.detail("write", `${i} of ${steps.length} records`);
    const res = await deleteToolingRecord(step.sobject, step.id, org);
    if (!res.success) {
      progress?.fail("write");
      // Nothing deleted yet: put it back on, as it was.
      if (!i && snap.active)
        await updateToolingRecord("LifeSciConfigRecord", snap.recordId, { IsActive: true }, org);
      return {
        ok: false,
        message: `Couldn't delete ${fix.recordLabel}: ${res.error || "unknown error"}.${i ? " It was partly removed — refresh the map before trying again." : ""}`,
      };
    }
  }
  progress?.end("write");
  return {
    ok: true,
    message: `Deleted ${fix.recordLabel}.`,
    undo: {
      kind: "createConfigRecord",
      label: `Recreate ${fix.recordLabel}`,
      category: fix.category,
      developerName: fix.developerName,
      recordLabel: snap.label || fix.recordLabel,
      fields: snap.fields,
      profiles: snap.profiles,
      permissionSets: snap.permissionSets,
      active: snap.active,
    },
  };
}
