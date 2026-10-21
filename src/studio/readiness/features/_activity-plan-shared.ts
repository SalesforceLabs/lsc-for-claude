/**
 * Building blocks shared by the Activity Plan, Territory & Users, Calendar,
 * KAM, and Lists & Filters readiness modules: trigger handler and DB Schema
 * checks that come with one-click fixes, and small query helpers.
 */

import { collectCategoryRecords } from "../../../config/collect.js";
import type { ConfigRecord } from "../../../config/types.js";
import { addProfileFix, newDbSchema } from "../../collectors/shared.js";
import { fieldProfiles } from "../../collectors/territory-users.js";
import { count, plural, query, type Row } from "../../helpers.js";
import { memoFocus } from "../../profile-focus.js";
import type { ReadinessCheck, StudioFix } from "../../types.js";
import { rowLabel, runCheck, type StudioCheckResult } from "../index.js";

export type CheckMeta = Omit<ReadinessCheck, "status" | "source" | "detail" | "examples" | "fixes">;

/** Compute `fn` once, on first use — checks of one module share their queries. */
export const lazy = memoFocus;

/** Result of a `SELECT COUNT() FROM …` query. */
export const countOf = count;

/** `Name` of each row, for the "examples" line. */
export const labels = (rows: Row[]): string[] => rows.map(rowLabel);

// ─── Trigger handlers ───────────────────────────────────────────────────────

export interface Handler {
  developerName: string;
  label: string;
  active: boolean;
}

export const loadHandlers = (org: string) =>
  lazy(async (): Promise<Map<string, Handler>> => {
    const rows = await query(`SELECT DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler`, org, true);
    return new Map(
      rows.map((r) => [
        String(r.DeveloperName),
        { developerName: String(r.DeveloperName), label: String(r.MasterLabel || r.DeveloperName), active: !!r.IsActive },
      ])
    );
  });

/**
 * Every named handler that exists in the org must be switched on. Names the
 * org doesn't have (an older package) are ignored; if none exist the check is skipped.
 */
export function handlersCheck(
  meta: CheckMeta,
  handlers: () => Promise<Map<string, Handler>>,
  names: string[]
): Promise<ReadinessCheck> {
  return runCheck(meta, async (): Promise<StudioCheckResult> => {
    const all = await handlers();
    const present = names.map((n) => all.get(n)).filter((h): h is Handler => !!h);
    if (present.length === 0) return { pass: true, skip: true, detail: "None of these trigger handlers exist in this org." };
    const off = present.filter((h) => !h.active);
    if (off.length === 0) return { pass: true, detail: `${plural(present.length, "handler")} on.` };
    return {
      pass: false,
      detail: `${off.length} of ${present.length} switched off: ${off.map((h) => h.developerName).join(", ")}.`,
      examples: off.map((h) => h.developerName),
      fixes: off.map(
        (h): StudioFix => ({
          kind: "setActive",
          label: `Switch on ${h.developerName}`,
          record: { type: "triggerHandler", developerName: h.developerName, label: h.label },
          from: false,
          to: true,
        })
      ),
    };
  });
}

// ─── DB Schema (iPad sync) ──────────────────────────────────────────────────

export const loadDbSchema = (org: string) =>
  lazy(() =>
    collectCategoryRecords(org, `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'DbSchema'`, { strict: true, cache: true })
  );

const sobjectOf = (r: ConfigRecord) => String(r.fields.SObject || "").toLowerCase();
const profileNames = (r: ConfigRecord) => r.assignments.filter((a) => a.level === "Profile").map((a) => a.name);

/**
 * Field profiles (those with LSC Mobile app settings) of the active users the
 * grouped `soqls` find — each selects a profile name as `pn`, e.g. owners of a
 * feature's records. These are the profiles that need its objects on the iPad.
 */
export async function fieldProfilesUsing(org: string, soqls: string[]): Promise<string[]> {
  const [field, ...groups] = await Promise.all([fieldProfiles(org), ...soqls.map((q) => query(q, org))]);
  const used = new Set(groups.flat().map((r) => String(r.pn ?? "")));
  return field.filter((p) => used.has(p)).sort();
}

/**
 * Each object needs an active DB Schema record that reaches at least one
 * profile, or the iPad never downloads its records. A switched-off record gets
 * a switch-on fix; a missing one gets an "Add to iPad sync" create for the
 * profiles that already sync the other objects of this check.
 *
 * With `audience` (the profiles whose users work with the feature), every
 * object must also reach each of those profiles; the ones it doesn't are
 * named, with an add-profile fix when the object has a single active record.
 */
export function dbSchemaCheck(
  meta: CheckMeta,
  schema: () => Promise<ConfigRecord[]>,
  objects: string[],
  audience?: () => Promise<string[]>
): Promise<ReadinessCheck> {
  return runCheck(meta, async (): Promise<StudioCheckResult> => {
    const [all, needs] = await Promise.all([schema(), audience ? audience() : Promise.resolve([])]);
    const wanted = new Set(objects.map((o) => o.toLowerCase()));
    const mine = all.filter((r) => wanted.has(sobjectOf(r)));
    const profiles = [...new Set(mine.filter((r) => r.isActive).flatMap(profileNames))].sort();
    const missing: string[] = [];
    const off: string[] = [];
    const unassigned: string[] = [];
    const gaps = new Map<string, string[]>();
    const fixes: StudioFix[] = [];
    for (const object of objects) {
      const recs = mine.filter((r) => sobjectOf(r) === object.toLowerCase());
      const live = recs.filter((r) => r.isActive);
      if (live.length) {
        if (!live.some((r) => r.isOrgLevel || r.assignments.length > 0)) unassigned.push(object);
        else if (!live.some((r) => r.isOrgLevel)) {
          const covered = new Set(live.flatMap(profileNames));
          for (const p of needs.filter((n) => !covered.has(n))) {
            gaps.set(p, [...(gaps.get(p) ?? []), object]);
            const fix = live.length === 1 ? addProfileFix(live[0], p, `Sync ${object} to ${p}`) : null;
            if (fix) fixes.push(fix);
          }
        }
        continue;
      }
      if (recs.length) {
        off.push(object);
        // Only an unambiguous record gets a fix; with several, which one to change is the admin's call.
        const r = recs[0];
        if (recs.length === 1) fixes.push({
          kind: "setActive",
          label: `Switch on ${object} sync`,
          record: { type: "config", category: "DbSchema", developerName: r.developerName, label: r.label || r.developerName },
          from: false,
          to: true,
        });
      } else {
        missing.push(object);
        const to = [...new Set([...profiles, ...needs])].sort();
        if (to.length) fixes.push(newDbSchema(object, all, to));
      }
    }
    const notReaching = [...gaps].map(([p, objs]) => `${p} doesn't sync ${objs.join(", ")}`);
    const problems = [
      missing.length ? `not synced: ${missing.join(", ")}` : "",
      off.length ? `switched off: ${off.join(", ")}` : "",
      unassigned.length ? `active but given to no profile: ${unassigned.join(", ")}` : "",
      ...notReaching,
    ].filter(Boolean);
    if (problems.length === 0) {
      const to = needs.length ? ` for ${plural(needs.length, "profile")} whose users work with them` : "";
      return { pass: true, detail: `All ${objects.length} objects sync to the iPad${to}.` };
    }
    return { pass: false, detail: `${problems.join("; ")}.`, examples: [...missing, ...off, ...unassigned, ...gaps.keys()], fixes: fixes.slice(0, 12) };
  });
}

// ─── Misc ───────────────────────────────────────────────────────────────────

/** `AsyncApexJob` rows that failed recently for batch classes matching `likes` (class name patterns). */
export async function failedJobs(org: string, likes: string[], days = 14): Promise<Row[]> {
  const cond = likes.map((l) => `ApexClass.Name LIKE '${l.replace(/'/g, "\\'")}'`).join(" OR ");
  return query(
    `SELECT ApexClass.Name, Status, ExtendedStatus, CreatedDate FROM AsyncApexJob WHERE JobType = 'BatchApex' AND Status IN ('Failed','Aborted') AND CreatedDate = LAST_N_DAYS:${days} AND (${cond}) ORDER BY CreatedDate DESC LIMIT 20`,
    org
  );
}
