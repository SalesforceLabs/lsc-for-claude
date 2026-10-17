/**
 * Builds the table list a fresh device would download, following
 * ProcessMetadataOperation.parseDatabase and UserSpecificPermissionsHandler:
 * db.json entries for tables that survive the user's readable-field filter,
 * minus config.json tables, with the permission-set variants (db_ps.json)
 * merged in by table name (lowest DeveloperName wins).
 */

import type { MetadataFiles, UserSpecificPermissions } from "./metadata.js";

export type AttachmentsSupport = "none" | "cache" | "background";

export interface SchemaTable {
  sobject: string;
  developerName: string;
  /** Fields requested from the server (already toLabel-wrapped where translation applies). */
  fields: string[];
  whereSoql?: string;
  deltaDateField?: string;
  attachmentsSupport: AttachmentsSupport;
  /** Value substituted for {USER.ACCESS.ENTITIES}. */
  userAccessEntities: string;
  /** Estimated per-record weight; drives the initial batch size. */
  weight: number;
  fromPermissionSet: boolean;
}

export interface SchemaResult {
  tables: SchemaTable[];
  userAccessEntities: string;
  notes: string[];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function isEmptyRecord(v: unknown): boolean {
  return !v || Object.keys(obj(v)).length === 0;
}

/** Throws the same condition that fails a device sync with a MetadataDownload error. */
export function assertUserSpecificPermissions(usp: UserSpecificPermissions): void {
  if (isEmptyRecord(usp.availableFields) || !usp.fieldPermissions?.length || !usp.objectPermissions?.length) {
    throw new Error(
      "The metadata download response has no userSpecificPermissions (availableFields, fieldPermissions and objectPermissions are all required); a device would fail this sync with a MetadataDownload error."
    );
  }
}

/**
 * Keep fields that are UserRecordAccess.* or readable per fieldPermissions
 * ("Obj.Field"), and drop tables left with no fields.
 */
export function filterAvailableFields(usp: UserSpecificPermissions): Record<string, string[]> {
  const readable = new Set<string>();
  for (const p of usp.fieldPermissions ?? []) if (p.readable) readable.add(p.field.toLowerCase());
  const out: Record<string, string[]> = {};
  for (const [table, fields] of Object.entries(usp.availableFields ?? {})) {
    const kept = fields.filter(
      (f) => f.toLowerCase().startsWith("userrecordaccess.") || readable.has(`${table}.${f}`.toLowerCase())
    );
    if (kept.length > 0) out[table] = kept;
  }
  return out;
}

const WEIGHT_ONE = new Set([
  "boolean", "autonumber", "date", "datetime", "time", "number", "percent", "currency", "int", "double", "summary",
  "lookup", "masterdetail", "metadatarelationship", "hierarchy", "reference", "externallookup", "indirectlookup",
  "system", "formula", "undefined",
]);
const WEIGHT_THREE = new Set(["text", "email", "phone", "url", "picklist", "encryptedtext", "string"]);
const WEIGHT_TEN = new Set(["textarea", "multiselectpicklist", "customdatatype"]);
const WEIGHT_FIVE = new Set(["address", "geolocation", "location"]);

export function fieldWeight(type: string | undefined, length: number | undefined): number {
  const t = (type ?? "undefined").toLowerCase();
  if (WEIGHT_ONE.has(t)) return 1;
  if (WEIGHT_THREE.has(t)) return 3;
  if (WEIGHT_TEN.has(t)) return 10;
  if (t === "longtextarea" || t === "html") return Math.min(100, Math.max(20, (length || 32768) / 1000));
  if (WEIGHT_FIVE.has(t)) return 5;
  if (t === "file") return 50;
  return 1;
}

export function whereComplexity(whereSoql: string | undefined): number {
  const selects = (whereSoql ?? "").toLowerCase().split("select").length - 1;
  return 1 + Math.max(0, selects - 1);
}

export function recordWeight(fieldWeights: number[], whereSoql: string | undefined): number {
  return fieldWeights.reduce((a, b) => a + b, 0) + (whereComplexity(whereSoql) - 1) * 2;
}

interface SobjectField {
  fullName: string;
  type?: string;
  length?: number;
  dataTranslationEnabled?: boolean;
}

function sobjectFields(sobjects: Record<string, unknown>, table: string): SobjectField[] {
  const entry = obj(sobjects[table]);
  return (Array.isArray(entry.fields) ? entry.fields : []).flatMap((raw) => {
    const f = obj(raw);
    const fullName = str(f.fullName);
    if (!fullName) return [];
    return [
      {
        fullName,
        type: str(f.type),
        length: typeof f.length === "number" ? f.length : Number(f.length) || undefined,
        dataTranslationEnabled: f.dataTranslationEnabled === true,
      },
    ];
  });
}

function normalizeAttachments(v: unknown): AttachmentsSupport {
  const s = typeof v === "string" ? v.toLowerCase() : "none";
  return s === "cache" || s === "background" ? s : "none";
}

function customPermissionNames(source: Record<string, unknown>): string[] {
  const list = Array.isArray(source.customPermissions) ? source.customPermissions : [];
  return list.flatMap((raw) => {
    const p = obj(raw);
    return p.enabled === true && typeof p.name === "string" ? [p.name] : [];
  });
}

/**
 * `'*'`, the profile name, its enabled custom permissions, then each permission
 * set and its enabled custom permissions, de-duplicated, comma-joined.
 */
export function buildUserAccessEntities(
  permissions: Record<string, unknown>,
  assignedPermissionSets?: string[]
): string {
  const entities: string[] = ["*"];
  const add = (name: string | undefined) => {
    if (name && !entities.includes(name)) entities.push(name);
  };
  const profile = obj(permissions.profile);
  add(str(profile.fullName));
  customPermissionNames(profile).forEach(add);
  const assigned = assignedPermissionSets?.length ? new Set(assignedPermissionSets.map((n) => n.toLowerCase())) : undefined;
  for (const raw of Array.isArray(permissions.permissionSets) ? permissions.permissionSets : []) {
    const ps = obj(raw);
    const name = str(ps.fullName);
    if (assigned && (!name || !assigned.has(name.toLowerCase()))) continue;
    add(name);
    customPermissionNames(ps).forEach(add);
  }
  return entities.map((e) => `'${e}'`).join(",");
}

function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? v.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
}

interface Candidate {
  sobject: string;
  developerName: string;
  raw: Record<string, unknown>;
  fromPermissionSet: boolean;
  fields: string[];
}

export interface BuildSchemaInput {
  files: MetadataFiles;
  usp: UserSpecificPermissions;
  /** Permission sets assigned to the user (from user-info). */
  assignedPermissionSets?: string[];
}

export function buildSchema(input: BuildSchemaInput): SchemaResult {
  const { files, usp } = input;
  const notes: string[] = [];
  assertUserSpecificPermissions(usp);

  const available = filterAvailableFields(usp);
  const lowerAvailable = new Map(Object.keys(available).map((k) => [k.toLowerCase(), k]));
  const excluded = new Set(Object.keys(files.config).map((k) => k.toLowerCase()));
  const userAccessEntities = buildUserAccessEntities(files.permissions, input.assignedPermissionSets);
  if (!input.assignedPermissionSets?.length && Array.isArray(files.permissions.permissionSets)) {
    notes.push("user-info listed no permission sets, so every permission set in permissions.json was used for {USER.ACCESS.ENTITIES}.");
  }

  const candidates: Candidate[] = [];
  for (const [key, raw] of Object.entries(files.db)) {
    const e = obj(raw);
    const sobject = str(e.SObject) ?? key;
    const availKey = lowerAvailable.get(sobject.toLowerCase());
    if (!availKey || excluded.has(sobject.toLowerCase())) continue;
    if (e.IsActive === false) continue;
    candidates.push({ sobject, developerName: str(e.DeveloperName) ?? key, raw: e, fromPermissionSet: false, fields: available[availKey] ?? [] });
  }

  // Permission-set variants. Only the profile receives injected availableFields, so a
  // permission-set entry contributes only when it carries its own availableFields.
  const assigned = new Set((input.assignedPermissionSets ?? []).map((n) => n.toLowerCase()));
  const psAvailable = new Map<string, Record<string, string[]>>();
  for (const raw of Array.isArray(files.permissions.permissionSets) ? files.permissions.permissionSets : []) {
    const ps = obj(raw);
    const name = str(ps.fullName);
    const af = obj(ps.availableFields);
    if (!name || Object.keys(af).length === 0) continue;
    const m: Record<string, string[]> = {};
    for (const [t, fields] of Object.entries(af)) if (Array.isArray(fields)) m[t.toLowerCase()] = fields.filter((f): f is string => typeof f === "string");
    psAvailable.set(name.toLowerCase(), m);
  }
  let psSkipped = 0;
  for (const [key, raw] of Object.entries(files.dbPs)) {
    const e = obj(raw);
    const sobject = str(e.SObject) ?? key.replace(/__c$/, "");
    const sets = splitList(e.PermissionSets).filter((n) => assigned.size === 0 || assigned.has(n.toLowerCase()));
    const fieldsFromPs = sets.map((n) => psAvailable.get(n.toLowerCase())?.[sobject.toLowerCase()]).find((f) => f !== undefined);
    if (!fieldsFromPs || excluded.has(sobject.toLowerCase())) {
      psSkipped++;
      continue;
    }
    candidates.push({ sobject, developerName: str(e.DeveloperName) ?? key, raw: e, fromPermissionSet: true, fields: fieldsFromPs });
  }
  if (psSkipped > 0) notes.push(`${psSkipped} permission-set table definition(s) were skipped (no per-permission-set availableFields).`);

  // Merge by table: sorted by name, lowest DeveloperName wins.
  candidates.sort((a, b) => a.developerName.localeCompare(b.developerName));
  const winners = new Map<string, Candidate>();
  for (const c of candidates) if (!winners.has(c.sobject.toLowerCase())) winners.set(c.sobject.toLowerCase(), c);

  const tables: SchemaTable[] = [];
  for (const c of winners.values()) {
    const known = sobjectFields(files.sobjects, c.sobject);
    const byName = new Map(known.map((f) => [f.fullName.toLowerCase(), f]));
    const translated = c.raw.dataTranslationEnabled === true;
    const fields: string[] = [];
    const weights: number[] = [];
    for (const name of c.fields) {
      if (name.toLowerCase().startsWith("userrecordaccess.")) {
        fields.push(name);
        weights.push(name.includes("Has") ? 1 : 3);
        continue;
      }
      const f = byName.get(name.toLowerCase());
      if (!f) continue;
      fields.push(translated && f.dataTranslationEnabled ? `toLabel(${f.fullName}) ${f.fullName}` : f.fullName);
      weights.push(fieldWeight(f.type, f.length));
    }
    if (fields.length === 0) continue;
    const whereSoql = str(c.raw.WhereSoql);
    tables.push({
      sobject: c.sobject,
      developerName: c.developerName,
      fields,
      whereSoql,
      deltaDateField: str(c.raw.DeltaDateField),
      attachmentsSupport: normalizeAttachments(c.raw.AttachmentsSupport),
      userAccessEntities,
      weight: recordWeight(weights, whereSoql),
      fromPermissionSet: c.fromPermissionSet,
    });
  }
  tables.sort((a, b) => a.sobject.localeCompare(b.sobject));
  return { tables, userAccessEntities, notes };
}
