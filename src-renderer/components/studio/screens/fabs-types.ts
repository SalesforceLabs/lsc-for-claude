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

export interface PublishedEmailTemplate {
  id: string;
  name: string;
  product?: string;
  description?: string;
}

export interface PublishedFabs {
  emailTemplates?: PublishedEmailTemplate[];
  visitCreate?: PublishedVisitCreate;
  order?: PublishedOrder;
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

// Order (Quote) create — structural copy of PublishedOrder in src/studio/screens/actions/orders.ts.
export interface OrderPricebook {
  id: string;
  name: string;
  description?: string;
  isStandard: boolean;
}

export interface OrderProduct {
  id: string;
  productId: string;
  name: string;
  code?: string;
  unitPrice: number;
}

export interface PublishedOrder {
  pricebooks: OrderPricebook[];
  products: Record<string, OrderProduct[]>;
  cut: string[];
  currency: string;
}
