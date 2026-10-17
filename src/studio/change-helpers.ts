/**
 * Building blocks shared by every Studio change kind (fixes.ts, create.ts,
 * access.ts): input checks, display formatting, audience warnings.
 */

import { runToolingQuery } from "../salesforce/cli.js";
import { collectProfileOptions } from "./collect.js";
import { ID_PATTERN, plural, type Row } from "./helpers.js";

const NAME_PATTERN = /^\w+$/;

/** Changes to these categories only reach the iPad after the mobile metadata cache is regenerated. */
export const MOBILE_CATEGORIES = new Set(["QuickAction", "CustomAction", "UISchema", "DbSchema"]);
export const PUBLISH_WARNING = "Publish to iPad afterwards so reps get the change.";

export function display(v: unknown): string {
  return v === null || v === undefined || v === "" ? "(empty)" : String(v);
}

export function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid record Id: ${id}`);
}

export function assertNames(...names: string[]): void {
  if (!names.every((n) => NAME_PATTERN.test(n))) throw new Error("Invalid config record reference");
}

export async function findConfigRecord(category: string, developerName: string, org: string): Promise<Row | null> {
  assertNames(category, developerName);
  const rec = await runToolingQuery(
    `SELECT Id, IsActive, IsOrgLevel, MasterLabel FROM LifeSciConfigRecord WHERE DeveloperName = '${developerName}' AND LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE Category = '${category}') LIMIT 1`,
    org
  );
  if (!rec.success) throw new Error(rec.error || "Query failed");
  return (rec.data?.records?.[0] as Row | undefined) ?? null;
}

/** "Gives access to 14 active users (LS MT Field Sales Representative)" — who gains and loses access when a profile list changes. */
export async function audienceWarnings(from: string[], to: string[], org: string): Promise<string[]> {
  const lower = (l: string[]) => new Set(l.map((n) => n.toLowerCase()));
  const [before, after] = [lower(from), lower(to)];
  const added = to.filter((n) => !before.has(n.toLowerCase()));
  const removed = from.filter((n) => !after.has(n.toLowerCase()));
  const users = new Map((await collectProfileOptions(org)).map((p) => [p.name.toLowerCase(), p.users]));
  const total = (names: string[]) => names.reduce((sum, name) => sum + (users.get(name.toLowerCase()) ?? 0), 0);
  const warnings: string[] = [];
  if (added.length) {
    const n = total(added);
    warnings.push(`Gives access to ${n ? plural(n, "active user") : "no active users yet"} (${added.join(", ")}).`);
  }
  // Removing a name nobody has (e.g. a misspelled profile) takes nothing away — no need to say so.
  const n = total(removed);
  if (n) warnings.push(`Takes access away from ${plural(n, "active user")} (${removed.join(", ")}).`);
  return warnings;
}
