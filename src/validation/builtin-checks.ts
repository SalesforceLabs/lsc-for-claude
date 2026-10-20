/**
 * Checks too involved for a SOQL condition, run by name from a rule or known cause
 * (`check: { type: builtin, name: ipad-pages, expect: "none" }`).
 */

import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { fetchCategories, isNavTab } from "../studio/collectors/shared.js";
import { lintPage } from "../studio/ipad-page-lint.js";
import type { CheckContext, CheckOutcome } from "./rules-executor.js";

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

// ── Named tabs ───────────────────────────────────────────────────────────────

const NOT_TAB_NAMES = new Set(["the", "a", "an", "my", "our", "their", "his", "her", "see", "any", "new", "this", "that", "of", "on"]);

/** The tab a symptom names ("Reps can't see the Samples tab" → "Samples"), or null. */
export function tabNameIn(symptom: string | undefined): string | null {
  const m = /((?:["“']?[\w'&-]+["”']?\s+){1,3})tab\b/i.exec(symptom ?? "");
  if (!m) return null;
  const words = m[1].trim().split(/\s+/);
  // Keep the words right before "tab" that aren't filler ("see the Samples" → "Samples").
  const kept: string[] = [];
  for (const w of words.reverse()) {
    if (NOT_TAB_NAMES.has(w.toLowerCase())) break;
    kept.unshift(w.replace(/^["'“]|["'”]$/g, ""));
  }
  const name = kept.join(" ").trim();
  return name && !/^(ipad|mobile|navigation|nav)$/i.test(name) ? name : null;
}

/** "Samples" matches "Sample", "Samples" and "Sample Inventory Management". */
function nameStem(name: string): string {
  return name.toLowerCase().replace(/s$/, "");
}

interface NamedTab {
  Id?: string;
  Name: string;
  Label: string;
  SobjectName?: string;
}

/** Org tabs (TabDefinition) whose label or API name contains the stem. */
async function orgTabsNamed(stem: string, targetOrg: string): Promise<NamedTab[] | null> {
  const like = stem.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[%_]/g, (c) => `\\${c}`);
  // TabDefinition takes no OR, so label and name are two queries.
  const [byLabel, byName] = await Promise.all(
    ["Label", "Name"].map((field) => runSoqlQuery(`SELECT Name, Label, SobjectName FROM TabDefinition WHERE ${field} LIKE '%${like}%' LIMIT 50`, targetOrg))
  );
  if (!byLabel.success && !byName.success) return null;
  const seen = new Map<string, NamedTab>();
  for (const r of [byLabel, byName]) for (const t of (r.data?.records ?? []) as Row[]) seen.set(String(t.Name), t as unknown as NamedTab);
  return [...seen.values()];
}

/**
 * The tab a symptom names: is it in the org at all, is it one the iPad always drops (a
 * samples_management name), and is its UI Settings tab, if it has one, active and assigned.
 */
async function namedTab(targetOrg: string, context: CheckContext): Promise<CheckOutcome> {
  const name = tabNameIn(context.symptom);
  if (!name) return { passed: false, message: 'Name the tab to check it, for example "the Samples tab".', unavailable: true };
  const stem = nameStem(name);
  const [tabs, uiSchema] = await Promise.all([orgTabsNamed(stem, targetOrg), fetchCategories(targetOrg, ["UISchema"]).catch(() => null)]);
  if (!tabs) return { passed: false, message: "Couldn't read the org's tabs.", unavailable: true };
  const settings = (uiSchema ?? []).filter(isNavTab).filter((r) => `${String(r.fields.TabName ?? "")} ${r.label ?? ""} ${r.developerName}`.toLowerCase().includes(stem));

  // ProcessMetadataOperation.parseNavigation drops these by name, whatever their visibility.
  const dropped = tabs.filter((t) => t.Name.toLowerCase().includes("samples_management"));
  const off = settings.filter((r) => !r.isActive || (!r.isOrgLevel && r.assignments.length === 0));
  const records: Row[] = [
    ...dropped.map((t) => ({ Name: `${t.Label} (${t.Name}): the iPad never shows tabs named *samples_management*` })),
    ...off.map((r) => ({ DeveloperName: `${r.label || r.developerName} (UI Settings): ${r.isActive ? "assigned to no profile" : "inactive"}` })),
  ];
  if (records.length) return { passed: false, message: `"${name}" is set up so the iPad can't show it.`, details: { records } };
  if (!tabs.length && !settings.length) {
    return { passed: false, message: `The org has no tab named like "${name}".`, details: { records: [{ Name: `No tab or UI Settings tab named like "${name}"` }] } };
  }
  const found = [...tabs.map((t) => `${t.Label} (${t.Name}${t.SobjectName && !/^0M0/.test(t.SobjectName) ? `, ${t.SobjectName}` : ""})`), ...settings.map((r) => `${r.label || r.developerName} (UI Settings)`)];
  return { passed: true, message: `Tabs named like "${name}": ${found.slice(0, 5).join(", ")}${found.length > 5 ? ` and ${found.length - 5} more` : ""}.`, details: { tabs } };
}

/** Object tabs named in the symptom whose object no active DB Schema record syncs, so the iPad drops them. */
async function namedTabObject(targetOrg: string, context: CheckContext): Promise<CheckOutcome> {
  const name = tabNameIn(context.symptom);
  if (!name) return { passed: false, message: 'Name the tab to check it, for example "the Samples tab".', unavailable: true };
  const [tabs, synced] = await Promise.all([orgTabsNamed(nameStem(name), targetOrg), syncedObjects(targetOrg)]);
  if (!tabs || !synced) return { passed: false, message: "Couldn't read the org's tabs or DB Schema.", unavailable: true };
  // Lightning page tabs carry a FlexiPage id (0M0) where object tabs carry the object.
  const objectTabs = tabs.filter((t) => t.SobjectName && !/^0M0/.test(t.SobjectName));
  if (!objectTabs.length) return { passed: true, message: `No object tab is named like "${name}".` };
  const unsynced = objectTabs.filter((t) => !synced.has(String(t.SobjectName).toLowerCase()));
  if (unsynced.length) {
    return {
      passed: false,
      message: `${unsynced.length} of ${objectTabs.length} tabs named like "${name}" show an object no active DB Schema record syncs.`,
      details: { records: unsynced.map((t) => ({ Name: `${t.Label} (${t.Name}): ${t.SobjectName} isn't synced` })) },
    };
  }
  return { passed: true, message: `Every object tab named like "${name}" has an active DB Schema record: ${objectTabs.map((t) => t.SobjectName).join(", ")}.` };
}

const BUILTIN: Record<string, (targetOrg: string, context: CheckContext) => Promise<CheckOutcome>> = {
  "ipad-pages": ipadPages,
  "named-tab": namedTab,
  "named-tab-object": namedTabObject,
};

/** The names a `builtin` check can use. */
export const BUILTIN_CHECKS = Object.keys(BUILTIN);

export async function runBuiltinCheck(name: string | undefined, targetOrg: string, context: CheckContext = {}): Promise<CheckOutcome> {
  const run = name ? BUILTIN[name] : undefined;
  if (!run) return { passed: false, message: `Unknown built-in check: ${name ?? "(none)"}`, unavailable: true };
  return run(targetOrg, context);
}
