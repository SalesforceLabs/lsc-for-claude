// Structural copy of PublishedAccounts in src/studio/screens/accounts.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedAccountCard {
  id: string;
  name: string;
  hco: boolean;
  address: string;
  license?: "valid" | "invalid";
  cells: string[][];
}

export interface PublishedAccountList {
  id: string;
  name: string;
  detail: string;
}

export interface PublishedAccounts {
  searchOnline: boolean;
  select: boolean;
  maps: boolean;
  newAccount: boolean;
  chips: { label: string; count: string }[];
  lists: { own: PublishedAccountList[]; shared: PublishedAccountList[] };
  sortLabel: string;
  columns: string[];
  cards: PublishedAccountCard[];
}
