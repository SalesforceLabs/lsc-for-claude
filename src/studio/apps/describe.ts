/** Compact object descriptions for the builder model: real field API names, types, picklist values, sync state, a record count. */

import { cachedDescribeSObject, runSoqlQuery } from "../../salesforce/cli.js";
import { errorMessage, RunAsError, userGet, type RunAs } from "./run-as.js";
import { syncedObjectsOf } from "./sync.js";
import type { AppObjectInfo } from "./types.js";

export const MAX_DESCRIBE_OBJECTS = 8;
const MAX_FIELDS = 120;
const MAX_CHILDREN = 30;
const MAX_PICKLIST = 25;
const COUNT_TIMEOUT_MS = 4000;

interface DescribedField {
  name: string;
  label: string;
  type: string;
  referenceTo?: string[];
  relationshipName?: string | null;
  compoundFieldName?: string | null;
  deprecatedAndHidden?: boolean;
  nameField?: boolean;
  nillable?: boolean;
  custom?: boolean;
  picklistValues?: { value: string; active?: boolean }[];
}

/** Fields no app reads. */
const SYSTEM = new Set([
  "IsDeleted",
  "SystemModstamp",
  "LastViewedDate",
  "LastReferencedDate",
  "MayEdit",
  "IsLocked",
  "CurrencyIsoCode",
  "LastActivityDate",
  "UserRecordAccessId",
  "IsPrivate",
]);
const NOISY_CHILD = /(Share|History|Feed|ChangeEvent|Tag|OwnerSharingRule)$/;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      () => (clearTimeout(t), resolve(undefined))
    );
  });
}

/** The fields worth showing, most useful first: Id, the name field, required, custom, then the rest. */
export function pickFields(fields: DescribedField[]): AppObjectInfo["fields"] {
  const rank = (f: DescribedField) =>
    f.name === "Id"
      ? 0
      : f.nameField
        ? 1
        : f.nillable === false && !f.name.endsWith("Id")
          ? 2
          : f.custom || f.name.endsWith("__c")
            ? 3
            : 4;
  const kept = fields
    .filter(
      (f) =>
        !f.deprecatedAndHidden &&
        !SYSTEM.has(f.name) &&
        f.type !== "address" &&
        f.type !== "location" &&
        !/^(base64|encryptedstring)$/.test(f.type)
    )
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .slice(0, MAX_FIELDS);
  return kept.map(({ f }) => {
    const picklist = f.picklistValues
      ?.filter((p) => p.active !== false)
      .map((p) => p.value)
      .slice(0, MAX_PICKLIST);
    return {
      name: f.name,
      label: f.label,
      type: f.type,
      ...(f.referenceTo?.length
        ? {
            referenceTo: f.referenceTo,
            ...(f.relationshipName ? { relationshipName: f.relationshipName } : {}),
          }
        : {}),
      ...(picklist?.length ? { picklist } : {}),
    };
  });
}

interface Described {
  name: string;
  label: string;
  queryable?: boolean;
  updateable?: boolean;
  fields: DescribedField[];
  childRelationships?: {
    childSObject: string;
    relationshipName: string | null;
    field: string;
    deprecatedAndHidden?: boolean;
  }[];
}

function childrenOf(d: Described): NonNullable<AppObjectInfo["childRelationships"]> {
  return (d.childRelationships ?? [])
    .filter(
      (c) => c.relationshipName && !c.deprecatedAndHidden && !NOISY_CHILD.test(c.childSObject)
    )
    .slice(0, MAX_CHILDREN)
    .map((c) => ({ name: c.relationshipName as string, object: c.childSObject, field: c.field }));
}

async function describeOne(
  name: string,
  org: string,
  synced: Set<string> | null,
  as?: RunAs
): Promise<AppObjectInfo> {
  const missing: AppObjectInfo = {
    name,
    label: name,
    exists: false,
    synced: synced ? synced.has(name) : null,
    fields: [],
  };
  if (!/^\w+$/.test(name)) return missing;
  const described = await cachedDescribeSObject(name, org);
  if (!described.success || !described.data) return missing;
  const admin = described.data as unknown as Described;
  let d = admin;
  let runAs: Pick<AppObjectInfo, "access" | "hiddenFields" | "note"> = {};
  if (as) {
    const who = as.username;
    const res = await userGet(as, `/sobjects/${admin.name}/describe`);
    if (res.status < 200 || res.status >= 300) {
      if (res.status !== 404 && res.status !== 403)
        throw new RunAsError(
          `Couldn't describe ${admin.name} as ${who}: ${errorMessage(res.data, `HTTP ${res.status}`)}`
        );
      return {
        ...missing,
        name: admin.name,
        label: admin.label,
        exists: true,
        access: "none",
        note: `${who} can't see ${admin.name} at all (no object access).`,
      };
    }
    d = res.data as Described;
    const visible = new Set(d.fields.map((f) => f.name));
    const hidden = admin.fields
      .filter((f) => !visible.has(f.name) && !f.deprecatedAndHidden && !SYSTEM.has(f.name))
      .map((f) => f.name);
    const access = d.queryable === false ? "none" : d.updateable ? "edit" : "read";
    const parts: string[] = [];
    if (access === "none") parts.push(`${who} can't read ${admin.name}.`);
    else {
      if (access === "read") parts.push(`${who} can read ${admin.name} but not edit it.`);
      if (hidden.length)
        parts.push(
          `${who} can't read ${hidden
            .slice(0, 8)
            .map((f) => `${admin.name}.${f}`)
            .join(
              ", "
            )}${hidden.length > 8 ? ` and ${hidden.length - 8} more` : ""} (field-level security).`
        );
    }
    runAs = {
      access,
      ...(hidden.length ? { hiddenFields: hidden.slice(0, 30) } : {}),
      ...(parts.length ? { note: parts.join(" ") } : {}),
    };
  }
  const children = childrenOf(d);
  const countOf = as
    ? userGet(as, `/query?q=${encodeURIComponent(`SELECT COUNT() FROM ${d.name}`)}`).then((r) =>
        r.status === 200 ? (r.data as { totalSize?: number }).totalSize : undefined
      )
    : runSoqlQuery(`SELECT COUNT() FROM ${d.name}`, org).then((r) =>
        r.success ? r.data?.totalSize : undefined
      );
  const count = await withTimeout(countOf, COUNT_TIMEOUT_MS);
  return {
    name: d.name,
    label: d.label,
    exists: true,
    synced: synced ? synced.has(d.name) : null,
    ...runAs,
    ...(typeof count === "number" ? { recordCount: count } : {}),
    fields: runAs.access === "none" ? [] : pickFields(d.fields),
    ...(children.length ? { childRelationships: children } : {}),
  };
}

/** `as`: describe what that test user can see (object and field access) instead of what the connected admin can. */
export async function describeForApp(
  objects: string[],
  org: string,
  as?: RunAs
): Promise<AppObjectInfo[]> {
  const names = [...new Set(objects)].slice(0, MAX_DESCRIBE_OBJECTS);
  const synced = await syncedObjectsOf(org);
  return Promise.all(names.map((n) => describeOne(n, org, synced, as)));
}
