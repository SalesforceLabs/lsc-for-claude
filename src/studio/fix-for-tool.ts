/**
 * Chat writes that Studio can make itself: the Electron app's write gate asks
 * `fixesForToolCall` what a write tool call would change, and queues the answer
 * in the pending-changes tray for review instead of running the tool.
 *
 * Each result is built from the org as it is now (`from` values read live), with
 * the same `StudioFix` shapes the Studio UI queues, so `studio_preview_fix` and
 * `studio_apply_fix` take them as they are. A call that can't be expressed
 * exactly (a field the record doesn't have yet, a fuzzy permission set name, an
 * object value) is `unsupported` with why — the gate then asks for approval and
 * the tool runs as written.
 */

import { extractFieldValue, normalizeDbSchemaName, queryFieldValues } from "../tools/helpers.js";
import { assertId, assertNames, MOBILE_CATEGORIES } from "./change-helpers.js";
import { inList, query, type Row } from "./helpers.js";
import type { RecordRef, StudioFix } from "./types.js";

/** A change as the tray holds it (`PendingChange` in the renderer). */
export interface ToolChange {
  fix: StudioFix;
  /** Profiles whose iPads the change reaches, for "Publish to iPad"; absent = everyone / unknown. */
  affects?: string[];
}

export type ToolFixes = { changes: ToolChange[]; note?: string } | { unsupported: string };

/** Write tools this module can express as Studio changes. */
export const MAPPED_TOOLS = [
  "update_admin_setting",
  "update_db_schema",
  "toggle_db_schema",
  "toggle_trigger_handler",
  "assign_permission_set",
  "unassign_permission_set",
] as const;

type Input = Record<string, unknown>;
type ConfigFix = Extract<StudioFix, { kind: "setConfigField" }>;
type Scalar = ConfigFix["to"];

const unsupported = (why: string): { unsupported: string } => ({ unsupported: why });
const isUnsupported = (v: unknown): v is { unsupported: string } =>
  typeof v === "object" && v !== null && "unsupported" in v;

const sameValue = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

function isScalar(v: unknown): v is Scalar {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())
    : [];

export async function fixesForToolCall(
  name: string,
  input: Input,
  org: string
): Promise<ToolFixes> {
  try {
    switch (name) {
      case "update_admin_setting":
        return await updateAdminSetting(input, org);
      case "update_db_schema":
        return await updateDbSchema(input, org);
      case "toggle_db_schema":
        return await toggleDbSchema(input, org);
      case "toggle_trigger_handler":
        return await toggleTriggerHandler(input, org);
      case "assign_permission_set":
      case "unassign_permission_set":
        return await permissionSetAccess(name === "assign_permission_set", input, org);
      default:
        return unsupported(`Studio has no equivalent for ${name}.`);
    }
  } catch (error) {
    return unsupported(
      `Couldn't read the org to build the change: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Admin Console records -------------------------------------------------------

interface ConfigTarget {
  id: string;
  category: string;
  developerName: string;
  label: string;
  active: boolean;
}

async function configRecordBy(where: string, org: string): Promise<ConfigTarget | null> {
  const [row] = await query(
    `SELECT Id, DeveloperName, MasterLabel, IsActive, LifeSciConfigCategory.Category FROM LifeSciConfigRecord WHERE ${where} LIMIT 1`,
    org,
    true
  );
  if (!row) return null;
  const category = (row.LifeSciConfigCategory as Row | undefined)?.Category;
  if (!category) return null;
  return {
    id: String(row.Id),
    category: String(category),
    developerName: String(row.DeveloperName),
    label: String(row.MasterLabel ?? row.DeveloperName),
    active: !!row.IsActive,
  };
}

/** The profiles a record is assigned to, so Publish to iPad can be preselected; absent for an org-level or unassigned record. */
async function profilesOf(target: ConfigTarget, org: string): Promise<string[] | undefined> {
  if (!MOBILE_CATEGORIES.has(target.category)) return undefined;
  const rows = await query(
    `SELECT AssignedToId FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId = '${target.id}' AND AssignmentLevel = 'Profile'`,
    org,
    true
  );
  const ids = [...new Set(rows.map((r) => String(r.AssignedToId)))];
  if (!ids.length) return undefined;
  const names = (await query(`SELECT Name FROM Profile WHERE Id IN (${inList(ids)})`, org)).map(
    (p) => String(p.Name)
  );
  return names.length ? names : undefined;
}

const configRef = (t: ConfigTarget): RecordRef => ({
  type: "config",
  category: t.category,
  developerName: t.developerName,
  label: t.label,
});

function activeFix(t: ConfigTarget, to: boolean): StudioFix {
  return {
    kind: "setActive",
    label: `${to ? "Activate" : "Deactivate"} ${t.label}`,
    record: configRef(t),
    from: t.active,
    to,
  };
}

interface FieldUpdate {
  field: string;
  value: unknown;
}

/** One `setConfigField` per update; every field must already have a value on the record, as the tray's edits do. */
async function fieldFixes(
  target: ConfigTarget,
  updates: FieldUpdate[],
  org: string
): Promise<StudioFix[] | { unsupported: string }> {
  if (!updates.length) return [];
  const { fieldValuesByRecord, queryError } = await queryFieldValues([target.id], org);
  if (queryError) return unsupported(queryError);
  const existing = new Map(
    (fieldValuesByRecord.get(target.id) ?? []).map((f) => [String(f.FieldName), f])
  );
  const fixes: StudioFix[] = [];
  for (const { field, value } of updates) {
    try {
      assertNames(field);
    } catch {
      return unsupported(`"${field}" isn't a valid field name.`);
    }
    const current = existing.get(field);
    if (!current)
      return unsupported(
        `${target.label} has no ${field} value yet; Studio edits values that exist, it doesn't add them.`
      );
    if (!isScalar(value))
      return unsupported(`The new ${field} value isn't a plain text, number or true/false value.`);
    const from = extractFieldValue(current);
    if (sameValue(from, value)) continue;
    fixes.push({
      kind: "setConfigField",
      label: `Set ${field} on ${target.label}`,
      category: target.category,
      developerName: target.developerName,
      recordLabel: target.label,
      field,
      from: isScalar(from) ? from : String(from),
      to: value,
    });
  }
  return fixes;
}

async function withAffects(
  target: ConfigTarget,
  fixes: StudioFix[],
  org: string
): Promise<ToolChange[]> {
  const affects = fixes.length ? await profilesOf(target, org) : undefined;
  return fixes.map((fix) => (affects ? { fix, affects } : { fix }));
}

async function updateAdminSetting(input: Input, org: string): Promise<ToolFixes> {
  const recordId = str(input.recordId);
  if (!recordId) return unsupported("No recordId.");
  assertId(recordId);
  const target = await configRecordBy(`Id = '${recordId}'`, org);
  if (!target) return unsupported("That Admin Console record wasn't found.");

  if (
    input.fields !== undefined &&
    (input.fields === null || typeof input.fields !== "object" || Array.isArray(input.fields))
  ) {
    return unsupported("fields isn't an object.");
  }
  if (input.fieldValues !== undefined && !Array.isArray(input.fieldValues))
    return unsupported("fieldValues isn't a list.");
  const fields = (input.fields ?? {}) as Input;
  const other = Object.keys(fields).filter((k) => k !== "IsActive");
  if (other.length)
    return unsupported(
      `Studio only changes a record's Active switch and field values, not ${other.join(", ")}.`
    );
  const fixes: StudioFix[] = [];
  if (fields.IsActive !== undefined) {
    if (typeof fields.IsActive !== "boolean") return unsupported("IsActive isn't true or false.");
    if (fields.IsActive !== target.active) fixes.push(activeFix(target, fields.IsActive));
  }
  const values = (input.fieldValues ?? []) as Input[];
  if (values.some((v) => !v || typeof v !== "object"))
    return unsupported("A fieldValues entry isn't an object.");
  const set = await fieldFixes(
    target,
    values.map((v) => ({ field: String(v.fieldName ?? ""), value: v.value })),
    org
  );
  if (isUnsupported(set)) return set;
  fixes.push(...set);
  return result(await withAffects(target, fixes, org), `${target.label} already has these values.`);
}

async function dbSchemaTarget(
  name: unknown,
  org: string
): Promise<ConfigTarget | { unsupported: string }> {
  const given = str(name);
  if (!given) return unsupported("No DB Schema record name.");
  const fullName = normalizeDbSchemaName(given);
  assertNames(fullName);
  const target = await configRecordBy(
    `DeveloperName = '${fullName}' AND LifeSciConfigCategory.Category = 'DbSchema'`,
    org
  );
  return target ?? unsupported(`No DB Schema record named ${fullName}.`);
}

async function updateDbSchema(input: Input, org: string): Promise<ToolFixes> {
  const target = await dbSchemaTarget(input.name, org);
  if (isUnsupported(target)) return target;
  const updates: FieldUpdate[] = [];
  const add = (field: string, value: unknown) =>
    value !== undefined && updates.push({ field, value });
  add("WhereSoql", input.whereSoql);
  add("OneWaySync", input.oneWaySync);
  add("AttachmentsSupport", input.attachmentsSupport);
  add("MandatoryFields", input.mandatoryFields);
  add("DeltaDateField", input.deltaDateField);
  // update_db_schema joins permission set names with "; ".
  add(
    "PermissionSets",
    Array.isArray(input.permissionSets) ? strings(input.permissionSets).join("; ") : undefined
  );

  const fixes: StudioFix[] = [];
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") return unsupported("isActive isn't true or false.");
    if (input.isActive !== target.active) fixes.push(activeFix(target, input.isActive));
  }
  const set = await fieldFixes(target, updates, org);
  if (isUnsupported(set)) return set;
  fixes.push(...set);
  return result(await withAffects(target, fixes, org), `${target.label} already has these values.`);
}

async function toggleDbSchema(input: Input, org: string): Promise<ToolFixes> {
  const target = await dbSchemaTarget(input.name, org);
  if (isUnsupported(target)) return target;
  if (typeof input.active !== "boolean") return unsupported("active isn't true or false.");
  const fixes = input.active === target.active ? [] : [activeFix(target, input.active)];
  return result(
    await withAffects(target, fixes, org),
    `${target.label} is already ${target.active ? "active" : "inactive"}.`
  );
}

async function toggleTriggerHandler(input: Input, org: string): Promise<ToolFixes> {
  const developerName = str(input.handlerName);
  if (!developerName) return unsupported("No handlerName.");
  assertNames(developerName);
  if (typeof input.active !== "boolean") return unsupported("active isn't true or false.");
  const [row] = await query(
    `SELECT DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = '${developerName}' LIMIT 1`,
    org,
    true
  );
  if (!row) return unsupported(`No trigger handler named ${developerName}.`);
  const label = String(row.MasterLabel ?? developerName);
  const from = !!row.IsActive;
  if (from === input.active)
    return { changes: [], note: `${label} is already ${from ? "active" : "inactive"}.` };
  return {
    changes: [
      {
        fix: {
          kind: "setActive",
          label: `${input.active ? "Activate" : "Deactivate"} ${label}`,
          record: { type: "triggerHandler", developerName, label },
          from,
          to: input.active,
        },
      },
    ],
  };
}

function result(changes: ToolChange[], nothingToDo: string): ToolFixes {
  return changes.length ? { changes } : { changes: [], note: nothingToDo };
}

// --- Permission sets -------------------------------------------------------------

async function permissionSetAccess(
  assigning: boolean,
  input: Input,
  org: string
): Promise<ToolFixes> {
  const wanted = str(input.permissionSetName);
  if (!wanted) return unsupported("No permissionSetName.");
  const esc = (s: string) => s.replace(/[\\']/g, (c) => `\\${c}`);
  const sets = await query(
    `SELECT Id, Label FROM PermissionSet WHERE (Label = '${esc(wanted)}' OR Name = '${esc(wanted)}') AND IsOwnedByProfile = false AND PermissionSetGroupId = null LIMIT 3`,
    org
  );
  if (sets.length !== 1) {
    return unsupported(
      sets.length
        ? `"${wanted}" matches more than one permission set.`
        : `No permission set is named exactly "${wanted}" (the tool matches by partial name).`
    );
  }
  const access = {
    type: "permissionSet" as const,
    id: String(sets[0].Id),
    label: String(sets[0].Label),
  };

  const ids = strings(input.userIds);
  const usernames = strings(input.usernames);
  if (!ids.length && !usernames.length) return unsupported("No users given.");
  for (const id of ids) assertId(id);
  const clauses = [
    ids.length ? `Id IN (${inList(ids)})` : "",
    usernames.length ? `Username IN (${inList(usernames)})` : "",
  ].filter(Boolean);
  const users = await query(
    `SELECT Id, Name, Username, IsActive FROM User WHERE (${clauses.join(" OR ")})`,
    org
  );
  const missing = [
    ...ids.filter((id) => !users.some((u) => String(u.Id).slice(0, 15) === id.slice(0, 15))),
    ...usernames.filter(
      (n) => !users.some((u) => String(u.Username).toLowerCase() === n.toLowerCase())
    ),
  ];
  if (missing.length) return unsupported(`Users not found: ${missing.join(", ")}.`);

  const held = await query(
    `SELECT Id, AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId = '${access.id}' AND AssigneeId IN (${inList(users.map((u) => String(u.Id)))})`,
    org
  );
  const assignmentOf = new Map(held.map((r) => [String(r.AssigneeId), String(r.Id)]));

  const changes: ToolChange[] = [];
  const skipped: string[] = [];
  for (const u of users) {
    const userId = String(u.Id);
    const userName = String(u.Name);
    const has = assignmentOf.get(userId);
    if (assigning) {
      if (has) skipped.push(userName);
      else if (!u.IsActive) return unsupported(`${userName} is inactive.`);
      else
        changes.push({
          fix: {
            kind: "assignAccess",
            label: `Give ${access.label} to ${userName}`,
            userId,
            userName,
            access,
          },
        });
    } else if (!has) skipped.push(userName);
    else
      changes.push({
        fix: {
          kind: "removeAccess",
          label: `Remove ${access.label} from ${userName}`,
          userId,
          userName,
          access,
          assignmentId: has,
        },
      });
  }
  const note = skipped.length
    ? `${skipped.join(", ")} ${assigning ? "already have" : "don't have"} ${access.label}.`
    : undefined;
  if (!changes.length) return { changes: [], note: note ?? "Nothing to change." };
  return { changes, ...(note ? { note } : {}) };
}
