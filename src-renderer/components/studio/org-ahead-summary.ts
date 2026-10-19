import type { LiveCompactLayout, LiveFlexiPage, LiveLayout, LiveListView } from "./types";
import type { PublishedComponent, PublishedLayout, PublishedListView, PublishedPage } from "./published-types";
import { aheadOf, matchRelatedLists, modelOf as layoutModel } from "./layout-draft";
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
/** How many changes the row itself names; the rest are "+N more" and open with the disclosure. */
export const ROW_LINES = 2;

export interface SummaryText {
  /** One line for the row. */
  text: string;
  /** Every change, one per line, for the tooltip and the disclosure. */
  all: string[];
}

export function describeSummary(lines: string[]): SummaryText {
  const all = unique(lines);
  if (all.length === 0) return { text: "", all };
  if (all.length <= ROW_LINES) return { text: all.join("; "), all };
  return { text: `${all.slice(0, ROW_LINES).join("; ")}; +${all.length - ROW_LINES} more`, all };
}


/**
 * What a reorder looks like to the person who made it: the items that left the longest run still in
 * their old order, each with what it now sits in front of. `was` and `now` hold the same items.
 */
export function reorderLines(was: string[], now: string[], name: (item: string) => string, where = ""): string[] {
  if (sameSequence(was, now)) return [];
  const at = now.map((x) => was.indexOf(x));
  // Longest increasing run of old positions: those items kept their relative order.
  const best: number[] = [];
  const prev: number[] = [];
  for (let i = 0; i < at.length; i++) {
    best[i] = 1;
    prev[i] = -1;
    for (let j = 0; j < i; j++) if (at[j] < at[i] && best[j] + 1 > best[i]) (best[i] = best[j] + 1), (prev[i] = j);
  }
  let end = best.indexOf(Math.max(...best));
  const kept = new Set<number>();
  for (; end >= 0; end = prev[end]) kept.add(end);
  const moved = now.map((x, i) => [x, i] as const).filter(([, i]) => !kept.has(i));
  if (moved.length > MAX_INLINE) return [`Rearranged ${moved.length} items${where}`];
  return moved.map(([x, i]) => (i === now.length - 1 ? `Moved ${name(x)} to the end${where}` : `Moved ${name(x)} above ${name(now[i + 1])}${where}`));
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
  const prettyRelated = (r: string) => prettyName(r.replace(/^Related(.*)List$/, "$1").replace(/RelatedList$/, "").replace(/\.[^.]*$/, ""));
  const out: string[] = [];
  const nth = (label: string, section: (typeof model.sections)[number]) => model.sections.filter((s) => s.label === label).indexOf(section);
  const pubKey = (src: { label: string; nth: number }) => `${src.label}#${src.nth}`;

  // A section the cache has under another name is a rename, not an add plus a remove.
  const pubKeys = new Set(published.sections.map((p) => pubKey(p.source!)));
  const liveKeyOf = new Map<(typeof model.sections)[number], string>();
  for (const sec of model.sections) liveKeyOf.set(sec, `${sec.label}#${nth(sec.label, sec)}`);
  const liveKeys = new Set(liveKeyOf.values());
  const renamed = new Map<string, string>(); // live key -> published key
  const usedPub = new Set<string>();
  for (const sec of model.sections) {
    const key = liveKeyOf.get(sec)!;
    if (pubKeys.has(key)) continue;
    const mine = new Set(sec.columns.flat().map((i) => i.field));
    if (mine.size === 0) continue;
    let best: { key: string; label: string; score: number } | null = null;
    for (const p of published.sections) {
      const k = pubKey(p.source!);
      if (liveKeys.has(k) || usedPub.has(k)) continue;
      const theirs = new Set(p.source!.fields.flat());
      if (theirs.size === 0) continue;
      const shared = [...mine].filter((f) => theirs.has(f)).length;
      const score = shared / Math.min(mine.size, theirs.size);
      if (score >= 0.5 && (!best || score > best.score)) best = { key: k, label: p.source!.label, score };
    }
    if (best) {
      renamed.set(key, best.key);
      usedPub.add(best.key);
      if (sec.heading) out.push(`Renamed the section "${best.label || "Untitled"}" to "${sec.label || "Untitled"}"`);
    }
  }
  const sectionKey = (sec: (typeof model.sections)[number]) => renamed.get(liveKeyOf.get(sec)!) ?? liveKeyOf.get(sec)!;

  // Fields in a section that is itself new are covered by the section line.
  const inNewSection = new Set<string>();
  for (const sec of model.sections) if (ahead.sections.has(sec.key) && !renamed.has(liveKeyOf.get(sec)!)) for (const col of sec.columns) for (const i of col) inNewSection.add(i.field);
  for (const sec of model.sections) if (ahead.sections.has(sec.key) && !renamed.has(liveKeyOf.get(sec)!)) out.push(`Added the section "${sec.label || "Untitled"}"`);
  for (const f of ahead.fields) if (!inNewSection.has(f)) out.push(`Added ${labelFrom(labels, f)}`);
  for (const g of ahead.gone) out.push(`Removed ${labelFrom(labels, g.item)}`);
  if (ahead.goneElsewhere > 0) out.push(`Removed ${ahead.goneElsewhere} ${ahead.goneElsewhere === 1 ? "field" : "fields"} with a deleted section`);
  const rel = matchRelatedLists(live.relatedLists, published.relatedLists);
  for (const r of rel.added) out.push(`Added the ${prettyRelated(r)} related list`);
  for (const r of rel.removed) out.push(`Removed the ${relatedLabel.get(r) ?? prettyRelated(r)} related list`);

  // Fields both have: moved to another section, or reordered inside one.
  const pubSection = new Map<string, string>();
  for (const p of published.sections) for (const f of p.source!.fields.flat()) pubSection.set(f, pubKey(p.source!));
  const moved: string[] = [];
  for (const sec of model.sections) {
    const key = sectionKey(sec);
    for (const f of unique(sec.columns.flat().map((i) => i.field))) {
      const was = pubSection.get(f);
      if (was !== undefined && was !== key) moved.push(f);
    }
  }
  for (const f of unique(moved)) out.push(`Moved ${labelFrom(labels, f)} to another section`);
  const movedSet = new Set(moved);
  for (const p of published.sections) {
    const src = p.source!;
    const sec = model.sections.find((s) => sectionKey(s) === pubKey(src));
    if (!sec) continue;
    const orgItems = unique(sec.columns.flat().map((i) => i.field));
    const pubItems = unique(src.fields.flat());
    const common = (xs: string[], other: string[]) => xs.filter((x) => other.includes(x) && !movedSet.has(x));
    out.push(...reorderLines(common(pubItems, orgItems), common(orgItems, pubItems), (f) => labelFrom(labels, f)));
  }
  const pairedLive = live.relatedLists.filter((r) => rel.pairs.has(r));
  const orgOrder = pairedLive.map((r) => rel.pairs.get(r)!);
  const pubOrder = published.relatedLists.map((r) => r.name).filter((r) => orgOrder.includes(r));
  if (!sameSequence(orgOrder, pubOrder)) out.push("Reordered the related lists");
  return out;
}

// --- Record header (compact layout) -------------------------------------------------

export function summarizeCompact(published: string[] | undefined, live: LiveCompactLayout): string[] | null {
  if (!published) return null;
  const isTitle = (f: string) => f.toLowerCase() === "name";
  const was = published.filter((f) => !isTitle(f));
  const now = live.fields.filter((f) => !isTitle(f));
  const labels = new Map(live.available.map((o) => [o.name, o.label] as const));
  const out: string[] = [];
  for (const f of now) if (!was.includes(f)) out.push(`Added ${labelFrom(labels, f)} to the record header`);
  for (const f of was) if (!now.includes(f)) out.push(`Removed ${labelFrom(labels, f)} from the record header`);
  out.push(...reorderLines(was.filter((f) => now.includes(f)), now.filter((f) => was.includes(f)), (f) => labelFrom(labels, f), " in the record header"));
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
  if (was.length === now.length) out.push(...reorderLines(was.map((p) => now.find((c) => same(p, c))!), now, (c) => labelFrom(labels, c), " in the list"));
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
interface PubBlock {
  label: string;
  key: string | null;
  tab: boolean;
  properties: Record<string, string>;
}

function publishedBlocks(page: PublishedPage): PubBlock[] {
  const out: PubBlock[] = [];
  const walk = (components: PublishedComponent[]) => {
    for (const c of components) {
      out.push({ label: c.label || prettyName(c.name.split(":").pop() ?? c.name), key: c.source ? sourceKey(c.source) : null, tab: false, properties: c.properties ?? {} });
      for (const t of c.tabs ?? []) {
        out.push({ label: t.title, key: t.source ? sourceKey(t.source) : null, tab: true, properties: {} });
        walk(t.components);
      }
    }
  };
  for (const r of page.regions) walk(r.components);
  return out;
}

/** "richTextValue" → "rich text value": a property's name as a person would say it. */
const propWords = (k: string) => prettyName(k).toLowerCase();

export function summarizeFlexiPage(published: PublishedPage | undefined, live: LiveFlexiPage): string[] | null {
  if (!published) return null;
  const blocks = publishedBlocks(published);
  if (blocks.some((b) => !b.key)) return null;
  const model = pageModel(live);
  const { aligned } = alignFlexiPagePartial(published, model);
  const out: string[] = [];
  for (const b of blocks) if (!aligned.has(b.key!)) out.push(b.tab ? `Removed the ${b.label} tab` : `Removed the ${b.label} component`);
  const kept = new Set(aligned.values());
  // The iPad draws only some of a page's regions (a Home page's sidebar isn't on it), so a
  // component in a region the published page doesn't have isn't something a rep would gain.
  const shown = new Set(published.regions.map((r) => r.name));
  for (const r of model.regions) {
    if (!r.facet && !shown.has(r.name)) continue;
    for (const i of r.items) {
      if (kept.has(i.key)) continue;
      const what = insertedLabel(i.component, i.properties);
      out.push(r.facet ? `Added ${what} inside a tab` : `Added ${what}`);
    }
  }
  // Property edits: only properties the published copy carries are compared (the iPad drops those it ignores).
  const items = new Map<string, { properties: Record<string, string> }>();
  for (const r of model.regions) for (const i of r.items) items.set(i.key, i);
  for (const b of blocks) {
    const hit = aligned.get(b.key!);
    const item = hit ? items.get(hit) : undefined;
    if (!item || b.tab) continue;
    const changed = Object.keys(b.properties).filter((k) => k in item.properties && String(item.properties[k]) !== String(b.properties[k]));
    if (changed.length) out.push(`${b.label}: ${changed.slice(0, 3).map(propWords).join(", ")} changed${changed.length > 3 ? ` (+${changed.length - 3} more)` : ""}`);
  }
  return out;
}
