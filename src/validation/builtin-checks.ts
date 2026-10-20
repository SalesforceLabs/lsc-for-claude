/**
 * Checks too involved for a SOQL condition, run by name from a rule or known cause
 * (`check: { type: builtin, name: ipad-pages, expect: "none" }`).
 */

import { runToolingQuery } from "../salesforce/cli.js";
import { lintPage } from "../studio/ipad-page-lint.js";
import type { CheckOutcome } from "./rules-executor.js";

/** How many Home and record pages `ipad-pages` reads, most recently changed first. */
export const IPAD_PAGES_LIMIT = 40;

type Row = Record<string, unknown>;

/** Objects an active DB Schema record syncs to the iPad, or null when they can't be read. */
async function syncedObjects(targetOrg: string): Promise<Set<string> | null> {
  const r = await runToolingQuery(
    "SELECT ObjectValue FROM LifeSciConfigFieldValue WHERE FieldName = 'SObject' AND LifeSciConfigRecord.IsActive = true " +
      "AND LifeSciConfigRecord.LifeSciConfigCategory.Category = 'DbSchema'",
    targetOrg
  );
  if (!r.success || !r.data) return null;
  return new Set((r.data.records as Row[]).map((x) => String(x.ObjectValue ?? "").toLowerCase()).filter(Boolean));
}

/**
 * The org's own Home pages and record pages of objects the iPad syncs (every record page when
 * DB Schema can't be read), linted against what the iPad does with them.
 */
async function ipadPages(targetOrg: string): Promise<CheckOutcome> {
  const [list, synced] = await Promise.all([
    runToolingQuery(
      "SELECT Id, DeveloperName, MasterLabel, Type, EntityDefinition.QualifiedApiName FROM FlexiPage " +
        "WHERE NamespacePrefix = null AND Type IN ('HomePage', 'RecordPage') ORDER BY LastModifiedDate DESC LIMIT 500",
      targetOrg
    ),
    syncedObjects(targetOrg),
  ]);
  if (!list.success || !list.data) return { passed: false, message: `Couldn't read Lightning pages: ${list.error ?? "no result"}`, unavailable: true };
  const objectOf = (p: Row) => String((p.EntityDefinition as Row | null | undefined)?.QualifiedApiName ?? "").toLowerCase();
  const pages = (list.data.records as Row[])
    .filter((p) => p.Type === "HomePage" || !synced || synced.has(objectOf(p)))
    .slice(0, IPAD_PAGES_LIMIT);
  if (pages.length === 0) return { passed: true, message: "The org has no Home pages, or record pages of synced objects, of its own." };

  // Tooling returns Metadata for one row per query.
  const read = await Promise.all(
    pages.map(async (p) => {
      const r = await runToolingQuery(`SELECT Metadata FROM FlexiPage WHERE Id = '${String(p.Id)}'`, targetOrg);
      const metadata = r.success ? ((r.data?.records[0] as Row | undefined)?.Metadata as Row | undefined) : undefined;
      return { page: p, metadata };
    })
  );
  const unread = read.filter((r) => !r.metadata);
  const records: Row[] = [];
  for (const { page, metadata } of read) {
    if (!metadata) continue;
    for (const problem of lintPage({ ...metadata, type: page.Type })) {
      records.push({ Id: page.Id, Name: `${String(page.MasterLabel)} (${String(page.DeveloperName)}): ${problem.message}`, Severity: problem.severity });
    }
  }
  if (records.length > 0) {
    const shown = new Set(records.map((r) => r.Id)).size;
    return {
      passed: false,
      message: `${shown} of ${read.length - unread.length} Home and record pages ${shown === 1 ? "draws" : "draw"} differently on the iPad. Pages reps only open on desktop don't matter.`,
      details: { records },
    };
  }
  if (unread.length === read.length) return { passed: false, message: "Couldn't read any Lightning page's metadata.", unavailable: true };
  return {
    passed: true,
    message: `${read.length - unread.length} Home and record pages checked; none draws differently on the iPad.${unread.length ? ` ${unread.length} couldn't be read.` : ""}`,
  };
}

const BUILTIN: Record<string, (targetOrg: string) => Promise<CheckOutcome>> = {
  "ipad-pages": ipadPages,
};

/** The names a `builtin` check can use. */
export const BUILTIN_CHECKS = Object.keys(BUILTIN);

export async function runBuiltinCheck(name: string | undefined, targetOrg: string): Promise<CheckOutcome> {
  const run = name ? BUILTIN[name] : undefined;
  if (!run) return { passed: false, message: `Unknown built-in check: ${name ?? "(none)"}`, unavailable: true };
  return run(targetOrg);
}
