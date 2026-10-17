// Structural copy of PublishedFabs in src/studio/screens/fabs.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedFabItem {
  name: string;
  label: string;
}

export interface PublishedFabs {
  home: PublishedFabItem[];
  records: Record<string, Record<string, PublishedFabItem[]>>;
}
