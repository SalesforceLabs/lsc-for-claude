import type { PublishedContent, PublishedContentCard, PublishedContentSection } from "./content-types";

export interface ContentView {
  segment: string;
  search: string;
  favorites: ReadonlySet<string>;
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
    .map((s: PublishedContentSection) => ({
      title: s.title,
      cards: s.cardIds
        .map((id) => byId.get(id))
        .filter((c): c is PublishedContentCard => !!c && (!needle || c.name.toLowerCase().includes(needle)) && inSegment(c, view.segment, manage, view.favorites)),
    }))
    .filter((s) => s.cards.length > 0);
}

/** "Collapse All" while any section is open, else "Expand All". */
export function collapseLabel(titles: string[], collapsed: ReadonlySet<string>): "Collapse All" | "Expand All" {
  return titles.length > 0 && titles.every((t) => collapsed.has(t)) ? "Expand All" : "Collapse All";
}

export const sectionTitle = (title: string) => title || "No Category";
