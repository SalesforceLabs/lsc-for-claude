/**
 * Pure logic behind "changes not on iPads yet": which org changes came after a profile's
 * metadata cache was generated, and which of them reach that profile. No org calls here,
 * so the boundaries and the reach rules are tested without a connection.
 */

import type { Row } from "./helpers.js";

export type UnpublishedKind =
  | "layout"
  | "compactLayout"
  | "flexiPage"
  | "app"
  | "recordType"
  | "tab"
  | "listView"
  | "dbSchema"
  | "uiSetting"
  | "action"
  | "appSetting";

/** One thing changed in the org after the profile's cache was generated. */
export interface UnpublishedItem {
  /** Unique within a result: `<kind>:<name>`. */
  id: string;
  kind: UnpublishedKind;
  /** The Metadata API name (`Account-Account Layout`, `Visit.Compact`) or the Admin Console `Category:DeveloperName`. */
  name: string;
  label: string;
  /** ISO time of the last change. */
  lastModifiedAt: string;
  /** Who made it; null when the org doesn't say (Lightning pages). */
  lastModifiedBy: string | null;
  /** What the renderer selects: `metadata:Layout:<fullName>` for documents, `config:<Category>:<DeveloperName>` for Admin Console records. */
  target: string;
  /** Already live on iPads without a publish (list views are read from the org when opened). */
  live?: boolean;
}

/** The documents the profile's snapshot references, so changes to other profiles' documents aren't counted. */
export interface KnownDocuments {
  layouts?: string[];
  compactLayouts?: string[];
  flexiPages?: string[];
  recordTypes?: string[];
  listViews?: string[];
  tabs?: string[];
}

export interface UnpublishedResult {
  profile: string;
  /** When the profile's live cache was generated (ISO): the time the check compares against. */
  cacheAt: string | null;
  /** When that generation started; changes after this are counted, since the cache may not have read them. */
  cacheStartedAt: string | null;
  checkedAt: string;
  /** The profile has no Active cache at all, so every change is "not published". */
  noCache: boolean;
  items: UnpublishedItem[];
  /** Kinds that couldn't be read. Never treat a result with errors as "up to date". */
  errors: { kind: string; message: string }[];
  /** The result was filtered to the documents the snapshot references. */
  scoped: boolean;
}

/** Names compare case-insensitively and without Metadata API percent-encoding. */
export function normalizeName(name: string): string {
  let n = name;
  try {
    n = decodeURIComponent(name);
  } catch {
    // Not valid percent-encoding: compare as written.
  }
  return n.trim().toLowerCase();
}

/** A lookup from a normalized name to the name as the snapshot wrote it; undefined = no scoping. */
export function nameIndex(known: string[] | undefined): Map<string, string> | undefined {
  if (!known) return undefined;
  return new Map(known.map((n) => [normalizeName(n), n]));
}

/** The snapshot's spelling of `name` when it references it; `null` when scoped and absent; `name` itself when unscoped. */
export function resolveName(index: Map<string, string> | undefined, name: string): string | null {
  if (!index) return name;
  return index.get(normalizeName(name)) ?? null;
}

/** Strictly after the cache: a change at the very moment the cache started is treated as read by it. */
export function isAfter(modifiedIso: unknown, boundaryMs: number): boolean {
  const at = Date.parse(String(modifiedIso ?? ""));
  return Number.isFinite(at) && at > boundaryMs;
}

/** SOQL datetime literal for a boundary. */
export function soqlTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nested = (r: Row, key: string): Row => (r[key] && typeof r[key] === "object" ? (r[key] as Row) : {});

/** Who a row says last modified it, if it says. */
export function modifiedBy(r: Row): string | null {
  return str(nested(r, "LastModifiedBy").Name) || null;
}

/** Salesforce writes `+0000`; the renderer wants a plain ISO instant. */
function isoTime(v: unknown): string {
  const at = Date.parse(str(v));
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

function build(kind: UnpublishedKind, name: string, label: string, r: Row, type: string, live = false): UnpublishedItem {
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    label,
    lastModifiedAt: isoTime(r.LastModifiedDate),
    lastModifiedBy: modifiedBy(r),
    target: `metadata:${type}:${name}`,
    ...(live ? { live: true } : {}),
  };
}

type Scope = Map<string, string> | undefined;

/** Layouts changed after the cache (`Object-Layout name`), limited to those the snapshot references. */
export function layoutItems(rows: Row[], scope: Scope): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const entity = str(nested(r, "EntityDefinition").QualifiedApiName) || str(r.TableEnumOrId);
    const label = str(r.Name);
    if (!entity || !label) continue;
    const name = resolveName(scope, `${entity}-${label}`);
    if (name !== null) out.push(build("layout", name, label, r, "Layout"));
  }
  return out;
}

export function compactLayoutItems(rows: Row[], scope: Scope): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const object = str(r.SobjectType);
    const dev = str(r.DeveloperName);
    if (!object || !dev) continue;
    const name = resolveName(scope, `${object}.${dev}`);
    if (name !== null) out.push(build("compactLayout", name, str(r.MasterLabel) || dev, r, "CompactLayout"));
  }
  return out;
}

export function flexiPageItems(rows: Row[], scope: Scope): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const dev = str(r.DeveloperName);
    if (!dev) continue;
    const name = resolveName(scope, dev);
    if (name !== null) out.push(build("flexiPage", name, str(r.MasterLabel) || dev, r, "FlexiPage"));
  }
  return out;
}

/** The Lightning app behind the profile's tab bar, when it changed after the cache. `app` is its full name (`ns__Name` for installed apps). */
export function appItems(rows: Row[], app: string | null): UnpublishedItem[] {
  if (!app) return [];
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const dev = str(r.DeveloperName);
    if (!dev) continue;
    const ns = str(r.NamespacePrefix);
    const fullName = ns ? `${ns}__${dev}` : dev;
    if (fullName !== app) continue;
    out.push(build("app", fullName, str(r.Label) || dev, r, "CustomApplication"));
  }
  return out;
}

export function recordTypeItems(rows: Row[], scope: Scope): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const object = str(r.SobjectType);
    const dev = str(r.DeveloperName);
    if (!object || !dev) continue;
    const name = resolveName(scope, `${object}.${dev}`);
    if (name !== null) out.push(build("recordType", name, str(r.Name) || dev, r, "RecordType"));
  }
  return out;
}

export function listViewItems(rows: Row[], scope: Scope): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const object = str(r.SobjectType);
    const dev = str(r.DeveloperName);
    if (!object || !dev) continue;
    const name = resolveName(scope, `${object}.${dev}`);
    if (name !== null) out.push(build("listView", name, str(r.Name) || dev, r, "ListView", true));
  }
  return out;
}

export function tabItems(rows: Row[], scope: Scope): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const r of rows) {
    const dev = str(r.DeveloperName);
    if (!dev) continue;
    const name = resolveName(scope, dev);
    if (name !== null) out.push(build("tab", name, str(r.MasterLabel) || dev, r, "CustomTab"));
  }
  return out;
}

/** An Admin Console record edited (its value rows or its assignments too), with who and when. */
export interface ConfigEdit {
  recordId: string;
  category: string;
  developerName: string;
  at: number;
  by: string | null;
  /** Assigned to every profile: org level, or through something other than a profile. */
  allProfiles: boolean;
  /** Profile ids it's assigned to. */
  profileIds: string[];
}

const CONFIG_KIND: Record<string, UnpublishedKind> = {
  DbSchema: "dbSchema",
  UISchema: "uiSetting",
  QuickAction: "action",
  CustomAction: "action",
  ApplicationSettings: "appSetting",
  ProfileBasedAppSettings: "appSetting",
};

/** Admin Console categories whose records end up in a profile's mobile metadata cache. */
export const MOBILE_CATEGORIES = Object.keys(CONFIG_KIND);

/** Edits to Admin Console records that reach the profile and came after the cache. */
export function configItems(edits: ConfigEdit[], profileId: string, boundaryMs: number): UnpublishedItem[] {
  const out: UnpublishedItem[] = [];
  for (const e of edits) {
    const kind = CONFIG_KIND[e.category];
    if (!kind || e.at <= boundaryMs) continue;
    if (!e.allProfiles && !e.profileIds.includes(profileId)) continue;
    const name = `${e.category}:${e.developerName}`;
    out.push({
      id: `${kind}:${name}`,
      kind,
      name,
      label: e.developerName,
      lastModifiedAt: new Date(e.at).toISOString(),
      lastModifiedBy: e.by,
      target: `config:${name}`,
    });
  }
  return out;
}

/** Newest first; ties by name so the order is stable. */
export function sortItems(items: UnpublishedItem[]): UnpublishedItem[] {
  return [...items].sort((a, b) => Date.parse(b.lastModifiedAt) - Date.parse(a.lastModifiedAt) || a.id.localeCompare(b.id));
}
