// Structural copy of PublishedFabs in src/studio/screens/fabs.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedFabAction {
  type: string;
  target?: string;
  targetType?: string;
  hideBrowser?: boolean;
}

export interface PublishedFabItem {
  name: string;
  label: string;
  action?: PublishedFabAction;
}

export interface PublishedFabs {
  visitCreate?: PublishedVisitCreate;
  home: PublishedFabItem[];
  records: Record<string, Record<string, PublishedFabItem[]>>;
}

export type LicenseState = "valid" | "invalid";

export interface VisitCreateAccount {
  person: boolean;
  subLabel?: string;
  place?: { id: string; text: string };
  licenses?: { state?: LicenseState; dea?: LicenseState; sdl?: LicenseState };
}

export interface PublishedVisitCreate {
  territory?: string;
  durationMinutes: number;
  blankStart: boolean;
  accounts: Record<string, VisitCreateAccount>;
}
