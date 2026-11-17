/**
 * Dashboards tab (lifesciences-ios OCEDemo/Tabs/DashboardsTab). The device
 * lists the `folder` and `Dashboard` tables it synced as a searchable tree
 * (DashboardsListFetcher) and opens one with GET /analytics/dashboards/{id}/describe.
 * Read-only: the list is read here as the viewer's org login, the open
 * dashboard on demand (`loadDashboardDetail`, behind `studio_manager_data`).
 */

import { apiRequest, dataPath } from "../../../salesforce/cli.js";
import { ID_PATTERN, inList, query, queryResult, type Row } from "../../helpers.js";
import { dashboardData, dashboardFromDescribe, type PublishedDashboard } from "../../published.js";
import type { ScreenContext } from "../context.js";

export interface DashboardItem {
  kind: "section" | "folder" | "dashboard";
  title: string;
  /** Dashboards only. */
  id?: string;
  children: DashboardItem[];
}

export interface PublishedDashboards {
  /** The Folder or Dashboard table isn't in the rep's DB Schema: the device shows "No data available". */
  noData?: boolean;
  items: DashboardItem[];
  note?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const ROWS = 5000;
const PRIVATE = "Private Dashboards";

/**
 * DashboardsListFetcher: root folders are sections with subfolders nested by parent; dashboards join folders by
 * folder id; dashboards in "Private Dashboards" form a section of their own; every level sorts by title.
 */
export function buildDashboardTree(folders: Row[], dashboards: Row[]): DashboardItem[] {
  const byTitle = (a: DashboardItem, b: DashboardItem) =>
    a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  const dash = (d: Row): DashboardItem => ({
    kind: "dashboard",
    title: str(d.Title),
    id: str(d.Id) || undefined,
    children: [],
  });
  const build = (f: Row, kind: "section" | "folder"): DashboardItem => ({
    kind,
    title: str(f.Name),
    children: [
      ...dashboards.filter((d) => str(d.FolderId) === str(f.Id)).map(dash),
      ...folders
        .filter((c) => str(c.ParentId) && str(c.ParentId) === str(f.Id))
        .map((c) => build(c, "folder")),
    ].sort(byTitle),
  });
  const sections = folders
    .filter((f) => !str(f.ParentId) && str(f.Name))
    .map((f) => build(f, "section"));
  const priv = dashboards.filter(
    (d) => str(d.FolderName) === PRIVATE && !folders.some((f) => str(f.Id) === str(d.FolderId))
  );
  if (priv.length)
    sections.push({ kind: "section", title: PRIVATE, children: priv.map(dash).sort(byTitle) });
  return sections.sort(byTitle);
}

export async function collectDashboards(
  ctx: ScreenContext
): Promise<PublishedDashboards | undefined> {
  // DashboardsListFetcher reads the local tables; a rep whose DB Schema lacks either sees "No data available".
  if (ctx.scope("Folder") === undefined || ctx.scope("Dashboard") === undefined)
    return { noData: true, items: [] };
  if (!ID_PATTERN.test(ctx.userId)) return undefined;
  const [folderResult, dashResult] = await Promise.all([
    queryResult(
      `SELECT Id, Name, ParentId FROM Folder WHERE Type = 'Dashboard' ORDER BY Name`,
      ctx.org,
      false,
      { allowTruncated: true, maxRows: ROWS }
    ),
    queryResult(
      `SELECT Id, Title, FolderId, FolderName, CreatedById FROM Dashboard ORDER BY Title`,
      ctx.org,
      false,
      { allowTruncated: true, maxRows: ROWS }
    ),
  ]);
  const folders = folderResult.records as Row[];
  const dashboards = dashResult.records as Row[];
  const notes: string[] = [];
  for (const [r, noun] of [
    [folderResult, "dashboard folders"],
    [dashResult, "dashboards"],
  ] as const)
    if (r.truncated)
      notes.push(
        `Read the first ${r.records.length.toLocaleString("en-US")} of ${r.totalSize.toLocaleString("en-US")} ${noun} by name.`
      );
  // The device holds what the rep can read: folders by UserRecordAccess, as the Reports tab does.
  const ids = folders.map((f) => str(f.Id)).filter((id) => ID_PATTERN.test(id));
  const readable = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await query(
      `SELECT RecordId, HasReadAccess FROM UserRecordAccess WHERE UserId = '${ctx.userId}' AND RecordId IN (${inList(ids.slice(i, i + 200))})`,
      ctx.org
    );
    for (const r of rows) if (r.HasReadAccess === true) readable.add(str(r.RecordId));
  }
  const visibleFolders = folders.filter((f) => readable.has(str(f.Id)));
  const visible = dashboards.filter(
    (d) =>
      readable.has(str(d.FolderId)) ||
      (str(d.FolderName) === PRIVATE && str(d.CreatedById) === ctx.userId)
  );
  const scope = ctx.scope("Dashboard");
  if (scope) notes.push("the device's sync filter on Dashboard isn't applied");
  return {
    items: buildDashboardTree(visibleFolders, visible),
    ...(notes.length ? { note: `Not in the preview: ${notes.join("; ")}.` } : {}),
  };
}

export interface DashboardDetail {
  /** null: the describe failed ("No data available" on the device). */
  dashboard: PublishedDashboard | null;
  error?: string;
}

/** GET /analytics/dashboards/{id}/describe, plus the cached results when the dashboard runs as a specified user. */
export async function loadDashboardDetail(org: string, id: string): Promise<DashboardDetail> {
  if (!ID_PATTERN.test(id)) return { dashboard: null, error: "Not a dashboard Id." };
  const describe = await apiRequest<Row>(
    await dataPath(org, `/analytics/dashboards/${id}/describe`),
    "GET",
    undefined,
    org
  );
  if (!describe.success || !describe.data)
    return { dashboard: null, error: describe.error || "No data available" };
  let dashboard = dashboardFromDescribe(describe.data);
  if (dashboard.sharedResults && dashboard.components.length) {
    const res = await apiRequest<Row>(
      await dataPath(org, `/analytics/dashboards/${id}`),
      "GET",
      undefined,
      org
    );
    if (res.success && res.data) {
      const data = new Map(
        (Array.isArray(res.data.componentData) ? (res.data.componentData as Row[]) : []).map(
          (c) => [str(c.componentId), c]
        )
      );
      dashboard = {
        ...dashboard,
        components: dashboard.components.map((c) => {
          const cd = data.get(c.id);
          const status = (cd?.status ?? {}) as Row;
          const result = (cd?.reportResult ?? {}) as Row;
          return cd && str(status.componentDataStatus) === "DATA" && result.factMap
            ? { ...c, data: dashboardData(result) }
            : c;
        }),
      };
    } else
      dashboard = {
        ...dashboard,
        dataNote: `Couldn't read the dashboard's results: ${res.error ?? "no data returned"}`,
      };
  }
  return { dashboard };
}
