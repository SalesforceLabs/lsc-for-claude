import type { LiveCompactLayout, LiveFlexiPage, LiveLayout, LiveListView } from "./types";
import type { PublishedComponent, PublishedLayout, PublishedListView, PublishedPage } from "./published-types";
import { aheadOf, modelOf as layoutModel } from "./layout-draft";
import { alignFlexiPagePartial, insertedLabel, modelOf as pageModel, sourceKey } from "./flexipage-draft";

/**
 * Plain-language lines for "what exactly changed" in the unpublished-changes popover: the org's
 * document against the published cache's copy. Pure, so the wording is tested without a renderer.
 * Each function returns one line per change, or null when the published copy can't be lined up
 * with the org's (the caller then falls back to a generic line).
 */

/** "Parent_Account__c" → "Parent Account"; "AccountId" → "Account". Used when the org gave no label. */
export function prettyName(api: string): string {
  const base = api.replace(/__[a-z]+$/i, "").replace(/Id$/, "");
  return base
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

const labelFrom = (labels: Map<string, string>, api: string): string => labels.get(api) ?? prettyName(api);
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const sameSequence = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The lines a row shows. At most `MAX_INLINE` are joined into the row; more become a count and live in the tooltip. */
export const MAX_INLINE = 3;

export interface SummaryText {
  /** One line for the row. */
  text: string;
  /** Every change, one per line, for the tooltip and the disclosure. */
  all: string[];
}

export function describeSummary(lines: string[]): SummaryText {
  const all = unique(lines);
  if (all.length === 0) return { text: "", all };
  if (all.length <= MAX_INLINE) return { text: all.join("; "), all };
  return { text: `${all.length} changes`, all };
}

// --- Page layouts -----------------------------------------------------------------

export function summarizeLayout(published: PublishedLayout | undefined, live: LiveLayout): string[] | null {
  const model = layoutModel(live);
  const ahead = aheadOf(published, model);
  if (!published || !ahead) return null;
  const labels = new Map<string, string>();
  for (const o of [...(live.available ?? []), ...(live.placed ?? [])]) labels.set(o.field, o.label);
  for (const sec of published.sections) for (const col of sec.fields ?? []) for (const f of col) labels.set(f.name, f.label);
  const relatedLabel = new Map(published.relatedLists.map((r) => [r.name, r.label] as const));
  const out: string[] = [];

  // Fields in a section that is itself new are covered by the section line.
  const inNewSection = new Set<string>();
  for (const sec of model.sections) if (ahead.sections.has(sec.key)) for (const col of sec.columns) for (const i of col) inNewSection.add(i.field);
  for (const sec of model.sections) if (ahead.sections.has(sec.key)) out.push(`Added the section "${sec.label || "Untitled"}"`);
  for (const f of ahead.fields) if (!inNewSection.has(f)) out.push(`Added ${labelFrom(labels, f)}`);
  for (const g of ahead.gone) out.push(`Removed ${labelFrom(labels, g.item)}`);
  if (ahead.goneElsewhere > 0) out.push(`Removed ${ahead.goneElsewhere} ${ahead.goneElsewhere === 1 ? "field" : "fields"} with a deleted section`);
  for (const r of ahead.related) out.push(`Added the ${relatedLabel.get(r) ?? prettyName(r)} related list`);
  for (const r of ahead.goneRelated) out.push(`Removed the ${relatedLabel.get(r) ?? prettyName(r)} related list`);

  // Fields both have: moved to another section, or reordered inside one.
  const nth = (label: string, section: (typeof model.sections)[number]) => model.sections.filter((s) => s.label === label).indexOf(section);
  const pubSection = new Map<string, string>();
  for (const p of published.sections) for (const f of p.source!.fields.flat()) pubSection.set(f, `${p.source!.label}#${p.source!.nth}`);
  const moved: string[] = [];
  for (const sec of model.sections) {
    const key = `${sec.label}#${nth(sec.label, sec)}`;
    const here = unique(sec.columns.flat().map((i) => i.field));
    for (const f of here) {
      const was = pubSection.get(f);
      if (was !== undefined && was !== key) moved.push(f);
    }
  }
  for (const f of unique(moved)) out.push(`Moved ${labelFrom(labels, f)} to another section`);
  const movedSet = new Set(moved);
  let rearranged = 0;
  for (const p of published.sections) {
    const src = p.source!;
    const sec = model.sections.find((s) => s.label === src.label && nth(s.label, s) === src.nth);
    if (!sec) continue;
    const orgItems = unique(sec.columns.flat().map((i) => i.field));
    const pubItems = unique(src.fields.flat());
    const common = (xs: string[], other: string[]) => xs.filter((x) => other.includes(x) && !movedSet.has(x));
    if (!sameSequence(common(pubItems, orgItems), common(orgItems, pubItems))) rearranged++;
  }
  if (rearranged === 1) out.push("Rearranged fields in a section");
  else if (rearranged > 1) out.push(`Rearranged fields in ${rearranged} sections`);
  const orgRelated = live.relatedLists.filter((r) => published.relatedLists.some((p) => p.name === r));
  const pubRelated = published.relatedLists.map((r) => r.name).filter((r) => live.relatedLists.includes(r));
  if (!sameSequence(orgRelated, pubRelated)) out.push("Reordered the related lists");
  return out;
}

// --- Record header (compact layout) -------------------------------------------------

export function summarizeCompact(published: string[] | undefined, live: LiveCompactLayout): string[] | null {
  if (!published) return null;
  const labels = new Map(live.available.map((o) => [o.name, o.label] as const));
  const out: string[] = [];
  for (const f of live.fields) if (!published.includes(f)) out.push(`Added ${labelFrom(labels, f)} to the record header`);
  for (const f of published) if (!live.fields.includes(f)) out.push(`Removed ${labelFrom(labels, f)} from the record header`);
  const was = published.filter((f) => live.fields.includes(f));
  const now = live.fields.filter((f) => published.includes(f));
  if (!sameSequence(was, now)) out.push("Reordered the record header fields");
  return out;
}

// --- List views -----------------------------------------------------------------------

export function summarizeListView(published: PublishedListView | undefined, live: LiveListView): string[] | null {
  const src = published?.source;
  if (!src) return null;
  const labels = new Map(live.available.map((o) => [o.name, o.label] as const));
  const same = (p: string, l: string) => p === l || p === `${l}Id`;
  const out: string[] = [];
  for (const c of live.columns) if (!src.columns.some((p) => same(p, c))) out.push(`Added the ${labelFrom(labels, c)} column`);
  for (const p of src.columns) if (!live.columns.some((c) => same(p, c))) out.push(`Removed the ${labelFrom(labels, p)} column`);
  const was = src.columns.filter((p) => live.columns.some((c) => same(p, c)));
  const now = live.columns.filter((c) => src.columns.some((p) => same(p, c)));
  if (was.length === now.length && !was.every((p, i) => same(p, now[i]))) out.push("Reordered the columns");
  if ((src.filterScope ?? null) !== (live.filterScope ?? null)) out.push(`List view scope: ${src.filterScope ?? "none"} → ${live.filterScope ?? "none"}`);
  const sig = (f: { field: string; operation: string; value: string }) => `${f.field}|${f.operation}|${f.value}`;
  const pubSig = new Set(src.filters.map(sig));
  const orgSig = new Set(live.filters.map(sig));
  for (const f of live.filters) if (!pubSig.has(sig(f))) out.push(`Added a filter on ${labelFrom(labels, f.field)}`);
  for (const f of src.filters) if (!orgSig.has(sig(f))) out.push(`Removed a filter on ${labelFrom(labels, f.field)}`);
  if ((src.booleanFilter ?? null) !== (live.booleanFilter ?? null)) out.push("Changed the filter logic");
  return out;
}

// --- Lightning pages ------------------------------------------------------------------

/** Published blocks (and tabs) with their source, depth first. */
function publishedBlocks(page: PublishedPage): { label: string; key: string | null; tab: boolean }[] {
  const out: { label: string; key: string | null; tab: boolean }[] = [];
  const walk = (components: PublishedComponent[]) => {
    for (const c of components) {
      out.push({ label: c.label || prettyName(c.name.split(":").pop() ?? c.name), key: c.source ? sourceKey(c.source) : null, tab: false });
      for (const t of c.tabs ?? []) {
        out.push({ label: t.title, key: t.source ? sourceKey(t.source) : null, tab: true });
        walk(t.components);
      }
    }
  };
  for (const r of page.regions) walk(r.components);
  return out;
}

export function summarizeFlexiPage(published: PublishedPage | undefined, live: LiveFlexiPage): string[] | null {
  if (!published) return null;
  const blocks = publishedBlocks(published);
  if (blocks.some((b) => !b.key)) return null;
  const model = pageModel(live);
  const { aligned } = alignFlexiPagePartial(published, model);
  const out: string[] = [];
  for (const b of blocks) if (!aligned.has(b.key!)) out.push(b.tab ? `Removed the ${b.label} tab` : `Removed the ${b.label} component`);
  const kept = new Set(aligned.values());
  for (const r of model.regions) {
    for (const i of r.items) {
      if (kept.has(i.key)) continue;
      const what = insertedLabel(i.component, i.properties);
      out.push(r.facet ? `Added ${what} inside a tab` : `Added ${what}`);
    }
  }
  return out;
}
