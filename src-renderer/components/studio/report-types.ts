// Structural copy of the report result types in src/studio/screens/report-data.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface PublishedReportCell {
  label: string;
  link?: boolean;
  bool?: boolean;
}

export type PublishedReportEntry = { kind: "row"; cells: PublishedReportCell[] } | { kind: "subtotal"; level: number; title: string; cells: string[] };

export interface PublishedReportData {
  format: "tabular" | "summary";
  columns: string[];
  groupHeader?: string;
  entries: PublishedReportEntry[];
  grandTotal?: { label: string; cells: string[] };
  truncated?: boolean;
}
