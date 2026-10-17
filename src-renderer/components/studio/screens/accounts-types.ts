// Structural copy of PublishedAccounts in src/studio/screens/accounts.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedAccountCard {
  id: string;
  name: string;
  hco: boolean;
  address: string;
  license?: "valid" | "invalid";
  /** Values the Sort popover orders by (empty or missing sorts last). */
  sort?: Record<string, string>;
  cells: string[][];
}

export interface PublishedAccountList {
  id: string;
  name: string;
  detail: string;
  /** Ids of the members the device holds; clicking the list narrows the cards to them. */
  memberIds?: string[];
}

export interface PublishedAccounts {
  searchOnline: boolean;
  select: boolean;
  maps: boolean;
  newAccount: boolean;
  chips: { label: string; count: string }[];
  lists: { own: PublishedAccountList[]; shared: PublishedAccountList[] };
  advancedFilters?: { id: string; name: string }[];
  /** Next Best Customers, Activity Plans, Activity Plans with Weightages, each with the accounts it lists. */
  builtInFilters?: PublishedAccountList[];
  sortLabel: string;
  columns: string[];
  cards: PublishedAccountCard[];
}
