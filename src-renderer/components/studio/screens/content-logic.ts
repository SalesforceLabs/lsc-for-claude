import type { PublishedContent, PublishedContentCard, PublishedContentSection } from "./content-types";

export interface ContentView {
  segment: string;
  search: string;
  favorites: ReadonlySet<string>;
  /** Filters ▸ Sharing Settings ▸ Approved for Sharing: only cards with cansendbyemail. */
  approvedOnly?: boolean;
  /** Filters ▸ Categories: a section title, or null/undefined for All. */
  category?: string | null;
}

/** CLMGridPresenter.filterByChoosenSegment: Presentations hides the viewer's own custom ones when custom presentations are managed. */
export function inSegment(card: PublishedContentCard, segment: string, manage: boolean, favorites: ReadonlySet<string>): boolean {
  if (segment === "My Presentations") return card.isCustom && card.ownedByViewer;
  if (segment === "Favorites") return favorites.has(card.id);
  return manage ? !(card.isCustom && card.ownedByViewer) : true;
}

/** applyFilter: search text, then segment; sections left empty are dropped. */
export function visibleSections(data: PublishedContent, view: ContentView): { title: string; cards: PublishedContentCard[] }[] {
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  const manage = data.segments.includes("My Presentations");
  const needle = view.search.trim().toLowerCase();
  return data.sections
    .filter((s) => view.category == null || s.title === view.category)
    .map((s: PublishedContentSection) => ({
      title: s.title,
      cards: s.cardIds
        .map((id) => byId.get(id))
        .filter((c): c is PublishedContentCard => !!c && (!needle || c.name.toLowerCase().includes(needle)) && inSegment(c, view.segment, manage, view.favorites) && (!view.approvedOnly || c.shareable)),
    }))
    .filter((s) => s.cards.length > 0);
}

/** "Collapse All" while any section is open, else "Expand All". */
export function collapseLabel(titles: string[], collapsed: ReadonlySet<string>): "Collapse All" | "Expand All" {
  return titles.length > 0 && titles.every((t) => collapsed.has(t)) ? "Expand All" : "Collapse All";
}

export const sectionTitle = (title: string) => title || "No Category";

/** Filters popover category rows: "All (n)" then one row per section with its card count (counts ignore the segment, as the app's category index does). */
export function categoryRows(data: PublishedContent): { title: string | null; label: string; count: number }[] {
  const total = data.sections.reduce((n, s) => n + s.cardIds.length, 0);
  return [{ title: null, label: "All", count: total }, ...data.sections.map((s) => ({ title: s.title, label: sectionTitle(s.title), count: s.cardIds.length }))];
}

/** Viewer page label, "1 of 4 Slides". */
export const slideLabel = (index: number, total: number) => `${index + 1} of ${total} Slides`;
