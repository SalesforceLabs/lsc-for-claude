/**
 * Building blocks shared by the Visit, Samples, Accounts and Products readiness
 * modules: trigger-handler checks that offer a switch-on fix, and the "is this
 * object synced to the iPad" check that offers a DB Schema fix.
 */

import { collectCategoryRecords } from "../../../config/collect.js";
import type { ConfigRecord } from "../../../config/types.js";
import { newDbSchema, profilesOf } from "../../collectors/shared.js";
import { inList, plural, query } from "../../helpers.js";
import { memoFocus } from "../../profile-focus.js";
import type { StudioFix } from "../../types.js";
import type { StudioCheckResult } from "../index.js";

/** Run `fn` once and share the promise — checks in one module read the same org data. */
export const once = memoFocus;

/** Every DB Schema record (object sync rows) in the org. */
export const loadDbSchema = (org: string) =>
  collectCategoryRecords(
    org,
    `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'DbSchema'`,
    { strict: true, cache: true }
  );

export interface HandlerRow {
  developerName: string;
  label: string;
  active: boolean;
}

export async function loadHandlers(org: string): Promise<HandlerRow[]> {
  const rows = await query(
    `SELECT DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler`,
    org,
    true
  );
  return rows.map((r) => ({
    developerName: String(r.DeveloperName),
    label: String(r.MasterLabel ?? r.DeveloperName),
    active: !!r.IsActive,
  }));
}

/**
 * Pass when every handler in `names` that exists in this org is active. Handlers
 * the org's package version doesn't ship are ignored; if none exist, the check is skipped.
 */
export function handlersResult(handlers: HandlerRow[], names: string[]): StudioCheckResult {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const present = handlers.filter((h) => wanted.has(h.developerName.toLowerCase()));
  if (!present.length)
    return { pass: true, skip: true, detail: "None of these handlers exist in this org." };
  const off = present.filter((h) => !h.active);
  if (!off.length) return { pass: true, detail: `${plural(present.length, "handler")} active.` };
  return {
    pass: false,
    detail: `${off.length} of ${present.length} switched off: ${off.map((h) => h.developerName).join(", ")}.`,
    examples: off.map((h) => h.developerName),
    fixes: off.map(
      (h): StudioFix => ({
        kind: "setActive",
        label: `Switch on ${h.label}`,
        record: { type: "triggerHandler", developerName: h.developerName, label: h.label },
        from: false,
        to: true,
      })
    ),
  };
}

const sobjectOf = (r: ConfigRecord) => String(r.fields.SObject ?? "").toLowerCase();

/**
 * Pass when each of `objects` has an active DB Schema record. Missing objects get
 * an "add to sync" fix (to the profiles that already sync the feature), switched-off
 * records a "switch on" fix.
 */
export async function syncResult(
  org: string,
  schema: ConfigRecord[],
  objects: string[]
): Promise<StudioCheckResult> {
  // Only objects that exist in this org can be synced.
  const defs = await query(
    `SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN (${inList(objects)})`,
    org
  );
  const exists = new Set(defs.map((d) => String(d.QualifiedApiName).toLowerCase()));
  const present = objects.filter((o) => exists.has(o.toLowerCase()));
  if (!present.length)
    return { pass: true, skip: true, detail: "None of these objects exist in this org." };

  const mine = schema.filter((r) => present.some((o) => o.toLowerCase() === sobjectOf(r)));
  const profiles = [...new Set(mine.filter((r) => r.isActive).flatMap(profilesOf))].sort();
  const missing: string[] = [];
  const off: ConfigRecord[] = [];
  // Only an unambiguous record gets a fix; with several, which one to change is the admin's call.
  const ambiguous = new Set<string>();
  for (const obj of present) {
    const records = mine.filter((r) => sobjectOf(r) === obj.toLowerCase());
    if (records.some((r) => r.isActive)) continue;
    if (records.length) off.push(records[0]);
    else missing.push(obj);
    if (records.length > 1) ambiguous.add(records[0].developerName);
  }
  if (!missing.length && !off.length)
    return { pass: true, detail: `${plural(present.length, "object")} synced.` };

  const fixes: StudioFix[] = off
    .filter((r) => !ambiguous.has(r.developerName))
    .map((r) => ({
      kind: "setActive",
      label: `Switch on ${String(r.fields.SObject)} sync`,
      record: {
        type: "config",
        category: "DbSchema",
        developerName: r.developerName,
        label: r.label || r.developerName,
      },
      from: false,
      to: true,
    }));
  // New records go to profiles that already sync this feature; with none, there is no value to copy.
  if (profiles.length) fixes.push(...missing.map((o) => newDbSchema(o, schema, profiles)));
  const parts = [
    missing.length ? `no DB Schema record for ${missing.join(", ")}` : "",
    off.length ? `switched off for ${off.map((r) => String(r.fields.SObject)).join(", ")}` : "",
  ].filter(Boolean);
  return {
    pass: false,
    detail: `Not synced to the iPad: ${parts.join("; ")}.`,
    examples: [...missing, ...off.map((r) => String(r.fields.SObject))],
    fixes,
  };
}

/** Pass when no object has two active DB Schema records for the same profile (they fight over the same sync). */
export function duplicateSyncResult(schema: ConfigRecord[], objects: string[]): StudioCheckResult {
  const wanted = new Set(objects.map((o) => o.toLowerCase()));
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const r of schema.filter((r) => r.isActive && wanted.has(sobjectOf(r)))) {
    for (const p of profilesOf(r).length ? profilesOf(r) : ["(everyone)"]) {
      const key = `${sobjectOf(r)}|${p}`;
      const other = seen.get(key);
      if (other)
        dupes.push(`${String(r.fields.SObject)} for ${p}: ${other} and ${r.developerName}`);
      else seen.set(key, r.developerName);
    }
  }
  return dupes.length
    ? {
        pass: false,
        detail: `${plural(dupes.length, "profile")} sync an object through two active records.`,
        examples: dupes,
      }
    : { pass: true, detail: "One sync record per object and profile." };
}
