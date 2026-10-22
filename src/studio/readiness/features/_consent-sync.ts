/**
 * Building blocks shared by the Consent, Intelligent Content, Field Email,
 * Surveys and App Alerts readiness modules: "are this feature's trigger
 * handlers on" and "does this feature's data sync to every profile that uses
 * it", each with one-click fixes.
 */

import type { ConfigRecord } from "../../../config/types.js";
import {
  addProfileFix,
  fetchCategories,
  newDbSchema,
  profilesOf,
} from "../../collectors/shared.js";
import { fieldProfiles } from "../../collectors/territory-users.js";
import { inList, plural, query } from "../../helpers.js";
import type { StudioFix } from "../../types.js";
import type { StudioCheckResult } from "../index.js";

/** Every DB Schema record in the org. */
export function loadDbSchema(org: string): Promise<ConfigRecord[]> {
  return fetchCategories(org, ["DbSchema"], true);
}

const sobject = (r: ConfigRecord) => String(r.fields.SObject ?? "").toLowerCase();

/** Whether `object` exists in the org — a COUNT that the org answers. */
async function objectExists(org: string, object: string): Promise<boolean> {
  try {
    await query(`SELECT Id FROM ${object} LIMIT 1`, org);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pass when every one of `objects` that exists in the org has an active DB
 * Schema record for each field profile that syncs `main`, the feature's own
 * object (the first of `objects` unless the caller names another). The
 * profiles that use the feature are read off `main`'s records — Studio doesn't
 * guess who should have it, and objects shared with other features (consent,
 * contact points) don't pull their profiles in. Profiles without LSC Mobile app
 * settings (admins) are left out. An object nobody syncs is flagged with no
 * profile named.
 */
export async function syncResult(
  org: string,
  schema: ConfigRecord[],
  objects: string[],
  main = objects[0]
): Promise<StudioCheckResult> {
  const present: string[] = [];
  await Promise.all(
    objects.map(async (o) => {
      if (schema.some((r) => sobject(r) === o.toLowerCase()) || (await objectExists(org, o)))
        present.push(o);
    })
  );
  present.sort((a, b) => objects.indexOf(a) - objects.indexOf(b));
  if (!present.length)
    return { pass: true, skip: true, detail: "None of these objects exist in the org." };

  const activeFor = (o: string) =>
    schema.filter((r) => r.isActive && sobject(r) === o.toLowerCase());
  // Field profiles, when the org says which they are; otherwise every profile counts.
  const field = await fieldProfiles(org).catch(() => [] as string[]);
  const isField = (p: string) =>
    !field.length || field.some((f) => f.toLowerCase() === p.toLowerCase());
  const mainActive = activeFor(main);
  const profiles = (
    mainActive.some((r) => r.isOrgLevel)
      ? field
      : [...new Set(mainActive.flatMap(profilesOf))].filter(isField)
  ).sort();
  // Who a new record is for: the feature's profiles, else whoever syncs any of these objects.
  const groupProfiles = profiles.length
    ? profiles
    : [...new Set(present.flatMap((o) => activeFor(o).flatMap(profilesOf)))].filter(isField).sort();

  const gaps: string[] = [];
  const fixes: StudioFix[] = [];
  for (const o of present) {
    const mine = schema.filter((r) => sobject(r) === o.toLowerCase());
    const active = mine.filter((r) => r.isActive);
    if (active.some((r) => r.isOrgLevel)) continue;
    const covered = new Set(active.flatMap(profilesOf));
    // Only an unambiguous record gets a fix; with several, which one to change is the admin's call.
    const offs = mine.filter((r) => !r.isActive);
    const off = offs.length === 1 ? offs[0] : undefined;
    if (!active.length) {
      gaps.push(`${o}: not synced`);
      if (off) {
        fixes.push({
          kind: "setActive",
          label: `Switch on ${o} sync`,
          record: {
            type: "config",
            category: "DbSchema",
            developerName: off.developerName,
            label: off.label || off.developerName,
          },
          from: false,
          to: true,
        });
      } else if (!offs.length && groupProfiles.length) {
        fixes.push(newDbSchema(o, schema, groupProfiles));
      }
      continue;
    }
    const missing = profiles.filter((p) => !covered.has(p));
    if (!missing.length) continue;
    gaps.push(`${o}: missing for ${missing.join(", ")}`);
    if (active.length === 1) {
      for (const p of missing) {
        const fix = addProfileFix(active[0], p, `Sync ${o} to ${p}`);
        if (fix) fixes.push(fix);
      }
    }
  }
  return gaps.length
    ? {
        pass: false,
        detail: `Not on the iPad for everyone who needs it — ${gaps.join("; ")}.`,
        examples: gaps,
        fixes: fixes.slice(0, 12),
      }
    : {
        pass: true,
        detail: `${plural(present.length, "object")} synced${profiles.length ? ` to ${plural(profiles.length, "profile")}` : ""}.`,
      };
}

/**
 * Pass when each of the named trigger handlers that exists in the org is
 * active; an inactive one gets a switch-on fix. Handlers the org's package
 * version doesn't have are ignored.
 */
export async function handlersResult(org: string, names: string[]): Promise<StudioCheckResult> {
  const rows = await query(
    `SELECT DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName IN (${inList(names)})`,
    org,
    true
  );
  if (!rows.length)
    return {
      pass: true,
      skip: true,
      detail: "None of these handlers exist in this org's package version.",
    };
  const off = rows.filter((r) => !r.IsActive);
  if (!off.length) return { pass: true, detail: `${plural(rows.length, "handler")} active.` };
  return {
    pass: false,
    detail: `${off.length} of ${rows.length} are switched off: ${off.map((r) => r.DeveloperName).join(", ")}.`,
    examples: off.map((r) => String(r.DeveloperName)),
    fixes: off.map((r) => ({
      kind: "setActive" as const,
      label: `Switch on ${r.DeveloperName}`,
      record: {
        type: "triggerHandler" as const,
        developerName: String(r.DeveloperName),
        label: String(r.MasterLabel ?? r.DeveloperName),
      },
      from: false,
      to: true,
    })),
  };
}

/** `Id`s and names of rows, for a failing check's examples. */
export function nameList(rows: Record<string, unknown>[], key = "Name"): string[] {
  return rows.map((r) => String(r[key] ?? r.Id));
}
