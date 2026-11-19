/** Structural copy of the types in src/studio/screens/manager/salesData.ts. Keep equal by hand. */
export interface SalesTable {
  type: "HCP" | "HCO";
  title: string;
  products: string[];
  rows: { account: string; values: (number | null)[] }[];
  truncated?: boolean;
}

export interface PublishedSalesData {
  tables: SalesTable[];
  pageSize: number;
  note?: string;
}
