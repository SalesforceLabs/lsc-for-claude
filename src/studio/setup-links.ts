/**
 * Deep links into Salesforce Setup for "Open in Setup". `setupPath` is pure (a
 * reference plus the Ids it needs gives an org-relative path); `resolveSetupLink`
 * looks the Ids up with one small Tooling/REST query through the direct path,
 * cached per org, and falls back to the list page the reference belongs to when
 * an Id can't be found — never to a link that doesn't exist.
 */

import { sharedRead } from "../config/read-cache.js";
import { query, type Row } from "./helpers.js";

export type SetupRef =
  | { type: "layout"; object: string; name: string }
  | { type: "field"; object: string; field: string }
  | { type: "compactLayout"; object: string; name: string }
  | { type: "flexiPage"; name: string }
  | { type: "listView"; object: string; name: string }
  | { type: "recordType"; object: string; name: string }
  | { type: "validationRule"; object: string; id: string }
  | { type: "apexTrigger"; id: string }
  | { type: "flow"; id: string }
  | { type: "user"; id: string }
  | { type: "profile"; id: string }
  | { type: "permissionSet"; id: string }
  | { type: "territory"; id: string }
  | { type: "record"; sobject: string; id: string };

export interface SetupLink {
  /** Org-relative path for `sf org open --path`. */
  path: string;
  /** True when it opens the exact item; false when it fell back to a list page. */
  exact: boolean;
}

const OBJECT = /^[A-Za-z][A-Za-z0-9_]*$/;
const SF_ID = /^[a-zA-Z0-9]{15,18}$/;

const obj = (o: string) => encodeURIComponent(o);
const om = (o: string, page: string, id?: string) =>
  `/lightning/setup/ObjectManager/${obj(o)}/${page}${id ? `/${encodeURIComponent(id)}/view` : "/view"}`;
/** A classic detail page wrapped in Lightning Setup. */
const classic = (setupPage: string, id: string) =>
  `/lightning/setup/${setupPage}/page?address=${encodeURIComponent(`/${id}`)}`;

/** The list page a reference falls back to when its Id can't be resolved. */
export function fallbackPath(ref: SetupRef): string {
  switch (ref.type) {
    case "layout":
      return om(ref.object, "PageLayouts");
    case "field":
      return om(ref.object, "FieldsAndRelationships");
    case "compactLayout":
      return om(ref.object, "CompactLayouts");
    case "recordType":
      return om(ref.object, "RecordTypes");
    case "validationRule":
      return om(ref.object, "ValidationRules");
    case "flexiPage":
      return "/lightning/setup/FlexiPageList/home";
    case "listView":
      return `/lightning/o/${obj(ref.object)}/list?filterName=${encodeURIComponent(ref.name)}`;
    case "apexTrigger":
      return "/lightning/setup/ApexTriggers/home";
    case "flow":
      return "/lightning/setup/Flows/home";
    case "user":
      return "/lightning/setup/ManageUsers/home";
    case "profile":
      return "/lightning/setup/EnhancedProfiles/home";
    case "permissionSet":
      return "/lightning/setup/PermSets/home";
    case "territory":
      return "/lightning/o/Territory2/list";
    case "record":
      return `/lightning/o/${obj(ref.sobject)}/list`;
  }
}

/** The path for a reference whose Id is known (`id`; for a field, the FieldDefinition's trailing part). */
export function setupPath(ref: SetupRef, id: string): string {
  switch (ref.type) {
    case "layout":
      return om(ref.object, "PageLayouts", id);
    case "field":
      return om(ref.object, "FieldsAndRelationships", id);
    case "compactLayout":
      return om(ref.object, "CompactLayouts", id);
    case "recordType":
      return om(ref.object, "RecordTypes", id);
    case "validationRule":
      return om(ref.object, "ValidationRules", id);
    case "flexiPage":
      return `/visualEditor/appBuilder.app?pageId=${encodeURIComponent(id)}`;
    case "listView":
      return `/lightning/o/${obj(ref.object)}/list?filterName=${encodeURIComponent(id)}`;
    case "apexTrigger":
      return classic("ApexTriggers", id);
    case "flow":
      // The Flow Builder opens a version.
      return `/builder_platform_interaction/flowBuilder.app?flowId=${encodeURIComponent(id)}`;
    case "user":
      return `/lightning/setup/ManageUsers/page?address=${encodeURIComponent(`/${id}?noredirect=1`)}`;
    case "profile":
      return classic("EnhancedProfiles", id);
    case "permissionSet":
      return classic("PermSets", id);
    case "territory":
      return `/lightning/r/Territory2/${encodeURIComponent(id)}/view`;
    case "record":
      return `/lightning/r/${obj(ref.sobject)}/${encodeURIComponent(id)}/view`;
  }
}

/** Layout names in the Metadata API are URL-encoded ("Account-Account %28Marketing%29 Layout"). */
export function decodeLayoutName(fullName: string, object: string): string {
  // "PersonAccount-…" layouts belong to Account; a bare Name (from a Layout row) has no prefix at all.
  const prefix = [object, "PersonAccount"].find((o) => fullName.startsWith(`${o}-`));
  const rest = prefix ? fullName.slice(prefix.length + 1) : fullName;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

const lit = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const first = (rows: Row[], key = "Id") =>
  rows[0] && typeof rows[0][key] === "string" ? (rows[0][key] as string) : null;

/** The Id (or trailing path part) the reference's page is addressed by, or null when it can't be found. */
async function lookup(ref: SetupRef, org: string): Promise<string | null> {
  switch (ref.type) {
    case "layout": {
      if (!OBJECT.test(ref.object)) return null;
      const name = decodeLayoutName(ref.name, ref.object);
      return first(
        await query(
          `SELECT Id FROM Layout WHERE Name = ${lit(name)} AND EntityDefinition.QualifiedApiName = ${lit(ref.object)} LIMIT 1`,
          org,
          true
        )
      );
    }
    case "field": {
      if (!OBJECT.test(ref.object) || !OBJECT.test(ref.field)) return null;
      // DurableId is "<entityId>.<field>": the field's Id for custom fields.
      const durable = first(
        await query(
          `SELECT DurableId FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = ${lit(ref.object)} AND QualifiedApiName = ${lit(ref.field)} LIMIT 1`,
          org
        ),
        "DurableId"
      );
      if (!durable?.includes(".")) return null;
      // Custom fields are addressed by Id (00N…); standard ones by API name (DurableId can drop the "Id": Visit.Place).
      const tail = durable.slice(durable.lastIndexOf(".") + 1);
      return /^00N[a-zA-Z0-9]{12,15}$/.test(tail) ? tail : ref.field;
    }
    case "compactLayout": {
      if (!OBJECT.test(ref.object)) return null;
      const name = ref.name.includes(".") ? ref.name.slice(ref.name.indexOf(".") + 1) : ref.name;
      return first(
        await query(
          `SELECT Id FROM CompactLayout WHERE SobjectType = ${lit(ref.object)} AND DeveloperName = ${lit(name)} LIMIT 1`,
          org,
          true
        )
      );
    }
    case "flexiPage":
      if (!OBJECT.test(ref.name)) return null;
      return first(
        await query(
          `SELECT Id FROM FlexiPage WHERE DeveloperName = ${lit(ref.name)} LIMIT 1`,
          org,
          true
        )
      );
    case "recordType": {
      if (!OBJECT.test(ref.object)) return null;
      return first(
        await query(
          `SELECT Id FROM RecordType WHERE SobjectType = ${lit(ref.object)} AND DeveloperName = ${lit(ref.name)} LIMIT 1`,
          org
        )
      );
    }
    case "listView": {
      // `filterName` takes the API name as well as the Id, so a name that looks right is already exact.
      if (!OBJECT.test(ref.object)) return null;
      const name = ref.name.includes(".") ? ref.name.slice(ref.name.indexOf(".") + 1) : ref.name;
      return first(
        await query(
          `SELECT Id FROM ListView WHERE SobjectType = ${lit(ref.object)} AND DeveloperName = ${lit(name)} LIMIT 1`,
          org
        )
      );
    }
    case "flow": {
      // `id` is the FlowDefinitionView DurableId (300…); the builder wants a version.
      if (!SF_ID.test(ref.id)) return null;
      const rows = await query(
        `SELECT ActiveVersionId, LatestVersionId FROM FlowDefinitionView WHERE DurableId = ${lit(ref.id)} LIMIT 1`,
        org
      );
      return first(rows, "ActiveVersionId") ?? first(rows, "LatestVersionId");
    }
    case "validationRule":
    case "apexTrigger":
    case "user":
    case "profile":
    case "permissionSet":
    case "territory":
    case "record":
      return SF_ID.test(ref.id) ? ref.id : null;
  }
}

const TTL_MS = 10 * 60_000;

/** Custom objects (and other `__x` entities) are addressed in Object Manager by their entity Id; layouts don't open by API name. */
export const isCustomEntity = (object: string) => /__[a-z]+$/i.test(object);

async function objectKey(object: string, org: string): Promise<string> {
  if (!isCustomEntity(object) || !OBJECT.test(object)) return object;
  const id = await sharedRead(
    org,
    `setup-link:entity:${object}`,
    async () =>
      first(
        await query(
          `SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = ${lit(object)} LIMIT 1`,
          org
        ),
        "DurableId"
      ),
    TTL_MS
  );
  return id && SF_ID.test(id) ? id : object;
}

/** The deepest page for `ref` in `org`; the list page when its Id can't be found. */
export async function resolveSetupLink(ref: SetupRef, org: string): Promise<SetupLink> {
  const fallback: SetupLink = { path: fallbackPath(ref), exact: false };
  try {
    const id = await sharedRead(
      org,
      `setup-link:${JSON.stringify(ref)}`,
      () => lookup(ref, org),
      TTL_MS
    );
    if (!id) return fallback;
    const key =
      "object" in ref && ref.type !== "listView" ? await objectKey(ref.object, org) : null;
    return { path: setupPath(key ? ({ ...ref, object: key } as SetupRef) : ref, id), exact: true };
  } catch {
    return fallback;
  }
}

export async function resolveSetupLinks(refs: SetupRef[], org: string): Promise<SetupLink[]> {
  return Promise.all(refs.map((r) => resolveSetupLink(r, org)));
}
