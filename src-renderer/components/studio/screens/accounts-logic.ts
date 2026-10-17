// Accounts tab list logic that runs in the renderer: sort options, sorting, chip and list filtering, address clipping. Pure, so it is unit tested.
import type { PublishedAccountCard } from "./accounts-types";

/** AccountFilterSortItemsFactory items the device's Sort popover lists (alphabetical by title). `key` is the card.sort field; NBC items have no synced data here. */
export const SORT_OPTIONS: { label: string; key: string | null }[] = [
  { label: "Address Line 1", key: "addressLine1" },
  { label: "City", key: "city" },
  { label: "First Name", key: "firstName" },
  { label: "Last Name", key: "lastName" },
  { label: "Last Visit Date", key: "lastVisit" },
  { label: "Name", key: "name" },
  { label: "NBC Distance", key: null },
  { label: "NBC Rank", key: null },
  { label: "NBC Reachability", key: null },
  { label: "Next Visit Date", key: "nextVisit" },
  { label: "Specialty", key: "specialty" },
  { label: "State", key: "state" },
  { label: "Zip", key: "zip" },
];

export const DEFAULT_SORT = "Name";

/** SearchBarViewController: "Sort by: " + name + "  ↑". */
export function sortPillLabel(label: string, ascending: boolean): string {
  return `Sort by: ${label}  ${ascending ? "↑" : "↓"}`;
}

/** Picking the sorted item again flips its direction; picking another starts ascending. */
export function nextSort(current: { label: string; ascending: boolean }, picked: string): { label: string; ascending: boolean } {
  return picked === current.label ? { label: picked, ascending: !current.ascending } : { label: picked, ascending: true };
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/** ORDER BY field is null, field collate icu: empty values stay last in either direction; ties keep the loaded (Name) order. NBC items have no data, so they keep the order. */
export function sortCards(cards: PublishedAccountCard[], label: string, ascending: boolean): PublishedAccountCard[] {
  const key = SORT_OPTIONS.find((o) => o.label === label)?.key;
  if (!key) return cards;
  const val = (c: PublishedAccountCard) => (c.sort?.[key] ?? "").trim();
  return cards
    .map((c, i) => ({ c, i, v: val(c) }))
    .sort((a, b) => {
      if (!a.v !== !b.v) return a.v ? -1 : 1;
      const d = a.v ? collator.compare(a.v, b.v) : 0;
      return d !== 0 ? (ascending ? d : -d) : a.i - b.i;
    })
    .map((x) => x.c);
}

/** All / HCO / HCP chips. */
export function filterByChip(cards: PublishedAccountCard[], chip: string): PublishedAccountCard[] {
  return chip === "HCO" ? cards.filter((c) => c.hco) : chip === "HCP" ? cards.filter((c) => !c.hco) : cards;
}

/** A sidebar list narrows the cards to its members; "All" (no list) keeps everything. */
export function filterByList(cards: PublishedAccountCard[], memberIds: string[] | undefined): PublishedAccountCard[] {
  if (!memberIds) return cards;
  const ids = new Set(memberIds);
  return cards.filter((c) => ids.has(c.id));
}

/** The card is a fixed 120pt: content runs 16..104pt, the address wraps without a line limit and only the lines that fit entirely show (no ellipsis). */
export const CARD_CONTENT_BOTTOM = 104;
export const ADDRESS_LINE = 17;
export function addressMaxLines(addressTop: number): number {
  return Math.max(0, Math.floor((CARD_CONTENT_BOTTOM - addressTop) / ADDRESS_LINE));
}
/** Top of the address inside the card: 16 + name box (24 one line, 38 wrapped) + gap (2.5 / 8.5). */
export function addressTop(nameWrapped: boolean): number {
  return nameWrapped ? 16 + 38 + 8.5 : 16 + 24 + 2.5;
}
