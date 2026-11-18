/** Structural copy of the types in src/studio/screens/manager/dashboards.ts. Keep equal by hand. */
export interface DashboardItem {
  kind: "section" | "folder" | "dashboard";
  title: string;
  id?: string;
  children: DashboardItem[];
}

export interface PublishedDashboards {
  noData?: boolean;
  items: DashboardItem[];
  note?: string;
}
